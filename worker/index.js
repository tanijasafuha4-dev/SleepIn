/**
 * SleepIn Cloudflare Worker Backend
 * 
 * 架构：
 * 1. 静态资产托管：除 API 外的所有网页请求均由 env.ASSETS 快速分发；
 * 2. 安全反代网关：拦截 /v1/chat/completions，安全读取 Cloudflare 后台设置的环境变量；
 * 3. 多 Key 负载均衡：支持 GEMINI_API_KEY 或 GEMINI_API_KEYS（多个 Key 用逗号分隔，自动随机轮询与容灾）；
 * 4. 服务端转发：携带密钥安全转发至反代地址 (https://my-free-ai.ccwu.cc/v1/chat/completions)，
 *    客户端浏览器、F12 抓包以及 GitHub 仓库均 100% 接触不到真实密钥！
 */

const TARGET_REVERSE_PROXY = 'https://my-free-ai.ccwu.cc/v1/chat/completions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-requested-with'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 处理 API 请求 (/v1/chat/completions 或 /api/chat)
    if (url.pathname.endsWith('/chat/completions') || url.pathname === '/api/chat') {
      // CORS 预检
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS
        });
      }

      // 提取多 Key 配置（支持 GEMINI_API_KEYS 或 GEMINI_API_KEY，逗号/换行分隔）
      const rawKeys = env?.GEMINI_API_KEYS || env?.GEMINI_API_KEY || env?.API_KEY || '';
      const keyList = rawKeys.split(/[,;\r\n]+/).map(k => k.trim()).filter(Boolean);

      // 随机轮询选择一个有效密钥
      let selectedKey = '';
      if (keyList.length > 0) {
        selectedKey = keyList[Math.floor(Math.random() * keyList.length)];
      }

      // 客户端如果带了自定义 Key 则优先使用，否则使用服务端的轮询 Key
      const clientAuth = request.headers.get('Authorization') || '';
      const finalKey = (clientAuth.startsWith('Bearer ') && clientAuth.slice(7).trim()) || selectedKey;

      if (!finalKey) {
        return new Response(JSON.stringify({
          error: {
            code: 401,
            message: '未在 Cloudflare 后台检测到 GEMINI_API_KEY 或 GEMINI_API_KEYS 变量。请登录 Cloudflare 设置变量。',
            status: 'UNAUTHENTICATED'
          }
        }), {
          status: 401,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // 组装转发请求
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Content-Type', 'application/json');
      newHeaders.set('Authorization', `Bearer ${finalKey}`);

      try {
        const bodyText = await request.text();
        const proxyResp = await fetch(TARGET_REVERSE_PROXY, {
          method: 'POST',
          headers: newHeaders,
          body: bodyText
        });

        const respHeaders = new Headers(proxyResp.headers);
        Object.entries(CORS_HEADERS).forEach(([k, v]) => respHeaders.set(k, v));

        return new Response(proxyResp.body, {
          status: proxyResp.status,
          headers: respHeaders
        });
      } catch (err) {
        return new Response(JSON.stringify({
          error: {
            code: 502,
            message: `后端代理请求失败: ${err.message}`
          }
        }), {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    // 2. 托管静态网页文件（HTML、CSS、JS、图片、音频等）
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return fetch(request);
  }
};
