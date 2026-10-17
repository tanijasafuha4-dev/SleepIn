/**
 * Cloudflare Worker - OpenAI to Google Gemini REST API (v1beta) Reverse Proxy
 * 部署于 Cloudflare Workers，反代域名示例：my-free-ai.ccwu.cc
 *
 * 核心功能：
 * 1. 接收 OpenAI 格式请求 (POST /v1/chat/completions)
 * 2. 转换为 Google Gemini REST API (v1beta) 规范
 * 3. 支持流式 (SSE) 与非流式输出
 * 4. 支持多模态（包含课表截图 image_url 解析）
 * 5. 鉴权变量优先级：客户端 Authorization > Worker 环境变量 GEMINI_API_KEY > 脚本内预置 DEFAULT_GEMINI_KEY
 */

// ==========================================
// 🔑 变量设置：可以在此处填入您的 Gemini API Key
// （也可以在 Cloudflare 后台设置环境变量 GEMINI_API_KEY）
// ==========================================
const DEFAULT_GEMINI_KEY = ""; // <- 可在此填入您的 API Key（如 'AIzaSy...'）

// 默认模型映射
const DEFAULT_MODEL = "gemini-1.5-flash"; // 或 gemini-2.0-flash / gemini-2.5-flash

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-requested-with",
};

export default {
  async fetch(request, env, ctx) {
    // 1. 处理 OPTIONS 预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    // 基础根路径健康检查
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "Gemini Reverse Proxy",
          endpoint: "/v1/chat/completions",
          timestamp: new Date().toISOString()
        }),
        {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        }
      );
    }

    // 仅代理 /v1/chat/completions
    if (!url.pathname.endsWith("/chat/completions")) {
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }

    try {
      const body = await request.json();

      // 2. 提取 API Key（优先级：前端传的 Bearer Token > Cloudflare 环境变量 > 脚本预置常量）
      let apiKey = "";
      const authHeader = request.headers.get("Authorization") || "";
      if (authHeader.startsWith("Bearer ")) {
        const clientToken = authHeader.slice(7).trim();
        // 过滤前端默认占位符
        if (clientToken && !clientToken.includes("free-proxy")) {
          apiKey = clientToken;
        }
      }

      if (!apiKey) {
        apiKey = env?.GEMINI_API_KEY || DEFAULT_GEMINI_KEY;
      }

      if (!apiKey) {
        return new Response(
          JSON.stringify({
            error: {
              message: "未检测到有效的 Gemini API Key。请在 Cloudflare 环境变量中添加 GEMINI_API_KEY，或在脚本中配置 DEFAULT_GEMINI_KEY。",
              type: "invalid_request_error"
            }
          }),
          { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // 3. 模型映射与规范化
      let requestedModel = body.model || DEFAULT_MODEL;
      // 若请求 gemini-3.5-flash-lite 或未知版本，映射到可用的高效 Vision 模型
      let targetGeminiModel = requestedModel;
      if (requestedModel.includes("gemini-3.5-flash-lite") || requestedModel.includes("flash-lite")) {
        targetGeminiModel = "gemini-1.5-flash"; // Google 官方现行稳定 Vision Flash 模型
      }

      // 4. 将 OpenAI 格式转换为 Gemini contents 格式
      const contents = [];
      let systemInstruction = null;

      for (const msg of (body.messages || [])) {
        if (msg.role === "system") {
          systemInstruction = {
            parts: [{ text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) }]
          };
          continue;
        }

        const role = msg.role === "assistant" ? "model" : "user";
        const parts = [];

        if (typeof msg.content === "string") {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text") {
              parts.push({ text: part.text });
            } else if (part.type === "image_url") {
              const urlVal = part.image_url?.url || "";
              if (urlVal.startsWith("data:")) {
                const match = urlVal.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  parts.push({
                    inlineData: {
                      mimeType: match[1],
                      data: match[2]
                    }
                  });
                }
              }
            }
          }
        }

        contents.push({ role, parts });
      }

      const geminiPayload = {
        contents,
        generationConfig: {
          temperature: body.temperature ?? 0.2,
          maxOutputTokens: body.max_tokens ?? 4096
        }
      };

      if (systemInstruction) {
        geminiPayload.systemInstruction = systemInstruction;
      }

      const isStream = Boolean(body.stream);
      const action = isStream ? "streamGenerateContent?alt=sse" : "generateContent";
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetGeminiModel}:${action}&key=${apiKey}`;

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload)
      });

      if (!geminiResponse.ok) {
        const errText = await geminiResponse.text();
        return new Response(errText, {
          status: geminiResponse.status,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }

      // 非流式响应转换回 OpenAI 格式
      if (!isStream) {
        const geminiJson = await geminiResponse.json();
        const candidate = geminiJson.candidates?.[0];
        const contentText = candidate?.content?.parts?.map(p => p.text).join("") || "";

        const openAiFormat = {
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: requestedModel,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: contentText
              },
              finish_reason: candidate?.finishReason || "stop"
            }
          ],
          usage: {
            prompt_tokens: geminiJson.usageMetadata?.promptTokenCount || 0,
            completion_tokens: geminiJson.usageMetadata?.candidatesTokenCount || 0,
            total_tokens: geminiJson.usageMetadata?.totalTokenCount || 0
          }
        };

        return new Response(JSON.stringify(openAiFormat), {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }

      // 流式响应透传
      return new Response(geminiResponse.body, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      });

    } catch (err) {
      return new Response(
        JSON.stringify({ error: { message: err.message } }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  }
};
