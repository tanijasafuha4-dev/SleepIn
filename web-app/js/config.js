/**
 * SleepIn Web - 全局 AI 识别服务配置 (Cloudflare / Gemini 反代)
 *
 * 💡 配置说明：
 * 1. 默认反向代理地址：https://my-free-ai.ccwu.cc/v1/chat/completions
 * 2. 默认模型：gemini-3.5-flash-lite
 * 3. 安全说明：
 *    为了防止开源到 GitHub 时泄露您的私有 API Key，此处 DEFAULT_API_KEY 保持为空。
 *    您在网页端“自定义接口 / 专属 Key 变量”输入框填入一次您的 AQ. 密钥后，
 *    浏览器会自动保存在当前设备的 localStorage 中，永久记住，无需反复填写！
 */

export const AI_CONFIG = {
  // Cloudflare 部署的反代地址 (兼容 OpenAI API 规范)
  ENDPOINT: 'https://my-free-ai.ccwu.cc/v1/chat/completions',

  // 默认模型：gemini-3.5-flash-lite
  DEFAULT_MODEL: 'gemini-3.5-flash-lite',

  // 站长 API Key 变量（保持为空以保护开源安全，用户端使用 localStorage 持久化记忆）
  DEFAULT_API_KEY: ''
};
