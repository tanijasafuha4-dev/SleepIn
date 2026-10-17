/**
 * Cloudflare Worker for SleepIn Web
 * 
 * 作用：
 * 1. 解决 Cloudflare 提示“不能将变量添加到只有静态资产的 Worker”的问题：
 *    只要项目中存在 _worker.js，Cloudflare 就会自动将本项目从“纯静态资产”升级为“全功能 Worker + 静态资产”！
 *    升级后，Cloudflare 后台的【运行时变量和密钥】功能将立即解锁！
 * 2. 服务端安全鉴权代理：
 *    拦截 /v1/chat/completions 请求，自动读取 Cloudflare 后台设置的环境变量 GEMINI_API_KEY，
 *    安全转发至 my-free-ai.ccwu.cc，彻底防止 API Key 在浏览器端泄露！
 * 3. 静态文件分发：
 *    其余所有普通页面请求（HTML/CSS/JS/图片）直接通过 env.ASSETS 托管秒开。
 */

const TARGET_REVERSE_PROXY = 'https://my-free-ai.ccwu.cc/v1/chat/completions';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 处理 AI 识图接口代理请求
    if (url.pathname.endsWith('/chat/completions') || url.pathname === '/api/chat') {
      // CORS 预检
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        });
      }

      // 从 Cloudflare 运行时环境变量中提取密钥
      const serverApiKey = env.GEMINI_API_KEY || env.API_KEY || '';

      // 构建转发请求头
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Content-Type', 'application/json');

      // 如果客户端未传 Key，则由 Cloudflare 服务端安全注入环境变量中的 Key
      if (!newHeaders.get('Authorization') && serverApiKey) {
        newHeaders.set('Authorization', `Bearer ${serverApiKey}`);
      }

      try {
        const bodyText = await request.text();
        const proxyResponse = await fetch(TARGET_REVERSE_PROXY, {
          method: 'POST',
          headers: newHeaders,
          body: bodyText
        });

        const respHeaders = new Headers(proxyResponse.headers);
        respHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(proxyResponse.body, {
          status: proxyResponse.status,
          headers: respHeaders
        });
      } catch (err) {
        return new Response(JSON.stringify({
          error: {
            message: `Cloudflare 服务端代理请求失败: ${err.message}`
          }
        }), {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }

    // 2. 托管与分发静态前端资源 (HTML, CSS, JS, PNG 等)
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return fetch(request);
  }
};
