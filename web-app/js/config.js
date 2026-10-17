/**
 * SleepIn Web - 全局 AI 识别服务配置 (Cloudflare / Gemini 反代)
 *
 * 💡 安全架构：
 * 前端不包含任何 API Key（防止 F12 / 网络抓包泄露），
 * 请求统一由 SleepIn 的 Cloudflare Worker (_worker.js) 在云端安全注入 GEMINI_API_KEY，
 * 并自动转发至您的反向代理 (my-free-ai.ccwu.cc)。
 */

export const AI_CONFIG = {
  // 服务端代理端点（在 workers.dev 域名下使用同源相对路径，其他域名访问时使用完整域名）
  ENDPOINT: (typeof window !== 'undefined' && window.location.hostname.includes('workers.dev'))
    ? './v1/chat/completions'
    : 'https://sleepin.tanijasafuha4.workers.dev/v1/chat/completions',

  // 默认模型：gemini-3.5-flash-lite
  DEFAULT_MODEL: 'gemini-3.5-flash-lite'
};
