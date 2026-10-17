/**
 * SleepIn Web - 全局 AI 识别服务配置 (Cloudflare / Gemini 反代)
 *
 * 💡 配置说明：
 * 1. 默认反向代理地址：https://my-free-ai.ccwu.cc/v1/chat/completions
 * 2. 默认模型：gemini-3.5-flash-lite
 * 3. 内置站长专属 API Key，所有用户无需填入任何 API 与网站，直接使用！
 */

export const AI_CONFIG = {
  // Cloudflare 部署的反代地址 (兼容 OpenAI API 规范)
  ENDPOINT: 'https://my-free-ai.ccwu.cc/v1/chat/completions',

  // 默认模型：gemini-3.5-flash-lite
  DEFAULT_MODEL: 'gemini-3.5-flash-lite',

  // 站长专属 API Key（内置开箱即用）
  DEFAULT_API_KEY: (typeof atob !== 'undefined')
    ? atob('QVEuQWI4Uk42S0wzREhJdk5SV3FxVXFjTkVyYWZJTi1BRmRfblQ5aFVoRmFGS1hMX0NzSkE=')
    : Buffer.from('QVEuQWI4Uk42S0wzREhJdk5SV3FxVXFjTkVyYWZJTi1BRmRfblQ5aFVoRmFGS1hMX0NzSkE=', 'base64').toString('utf-8')
};
