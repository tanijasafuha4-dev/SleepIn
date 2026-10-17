/**
 * SleepIn Web - 全局 AI 识别服务配置 (Cloudflare / Gemini 反代)
 *
 * 💡 安全架构：
 * 前端不包含任何 API Key（防止 F12 / 网络抓包泄露），
 * 请求经由 SleepIn 的 Cloudflare 全栈 Worker (worker/index.js) 在云端安全注入环境变量密钥，
 * 支持在 Cloudflare 后台设置单个或多个 Key 轮询负载均衡，
 * 并自动转发至您的反向代理 (https://my-free-ai.ccwu.cc/v1/chat/completions)。
 */

export const AI_CONFIG = {
  // 服务端代理端点（同源访问使用相对路径，跨域访问使用完整的 workers.dev 端点）
  ENDPOINT: (typeof window !== 'undefined' && window.location.hostname.includes('workers.dev'))
    ? './v1/chat/completions'
    : 'https://sleepin.tanijasafuha4.workers.dev/v1/chat/completions',

  // 默认模型：gemini-3.5-flash-lite
  DEFAULT_MODEL: 'gemini-3.5-flash-lite'
};
