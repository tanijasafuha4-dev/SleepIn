/**
 * SleepIn Web - 全局 AI 识别服务配置 (Cloudflare / Gemini 反代)
 *
 * 💡 站长配置说明：
 * 1. 默认反向代理地址：https://my-free-ai.ccwu.cc/v1/chat/completions
 * 2. 默认模型：gemini-3.5-flash-lite
 * 3. 变量设置：您可以在下方 DEFAULT_API_KEY 变量中填入您的 Google Gemini API Key。
 *    填入后，所有访问您网页的用户无需填入任何 API 与网址，即可直接使用“课表截图一键识别转 CSV”！
 *
 * 提示：如果您在 Cloudflare Worker 的后台环境变量中已经绑定了 GEMINI_API_KEY，
 * 则下方的 DEFAULT_API_KEY 也可以留空，反代服务端会自动替客户端注入 API Key。
 */

export const AI_CONFIG = {
  // Cloudflare 部署的反代地址 (兼容 OpenAI API 规范)
  ENDPOINT: 'https://my-free-ai.ccwu.cc/v1/chat/completions',

  // 默认模型：gemini-3.5-flash-lite
  DEFAULT_MODEL: 'gemini-3.5-flash-lite',

  // 站长 API Key 变量：在此填入您的 API Key（如 'AIzaSy...'）
  DEFAULT_API_KEY: ''
};
