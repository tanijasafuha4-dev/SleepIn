/**
 * SleepIn Web - 全局 AI 识别服务配置 (Cloudflare / Gemini 反代)
 *
 * 💡 安全架构：
 * 前端不包含任何 API Key（防止 F12 / 网络抓包泄露），
 * 默认直接调用您的 Cloudflare 反向代理服务 (my-free-ai.ccwu.cc)。
 */

export const AI_CONFIG = {
  // Cloudflare 部署的反代地址 (兼容 OpenAI API 规范)
  ENDPOINT: 'https://my-free-ai.ccwu.cc/v1/chat/completions',

  // 默认模型：gemini-3.5-flash-lite
  DEFAULT_MODEL: 'gemini-3.5-flash-lite'
};
