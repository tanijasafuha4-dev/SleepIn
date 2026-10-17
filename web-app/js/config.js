/**
 * SleepIn Web - 全局 AI 识别服务配置 (Cloudflare / Gemini 反代)
 *
 * 💡 站长配置与安全说明：
 * 1. 默认反向代理地址：https://my-free-ai.ccwu.cc/v1/chat/completions
 * 2. 默认模型：gemini-3.5-flash-lite
 * 3. 🛡️ 开源防泄露保护机制（.gitignore）：
 *    本项目开源于 GitHub，为了防止站长的 API Key 被公开导致泄露或封禁，
 *    已在根目录 .gitignore 中永久排除了 `web-app/js/config.local.js`。
 *    
 *    如果您希望在自己的本地或私有部署中免输入 Key：
 *    - 复制同目录下的 `config.local.example.js` 为 `config.local.js`
 *    - 在其中填入您的真实 `AQ.` 开头的 API Key
 *    - 系统会自动通过下方逻辑静默读取，且 Git 绝不会将它提交到 GitHub！
 */

export const AI_CONFIG = {
  // Cloudflare 部署的反代地址 (兼容 OpenAI API 规范)
  ENDPOINT: 'https://my-free-ai.ccwu.cc/v1/chat/completions',

  // 默认模型：gemini-3.5-flash-lite
  DEFAULT_MODEL: 'gemini-3.5-flash-lite',

  // 站长 API Key 变量（公开开源仓库中默认保留为空，请勿直接在此提交真实密钥）
  DEFAULT_API_KEY: ''
};

// 尝试安全合并受 .gitignore 保护的本地私有配置 config.local.js
try {
  const localModule = await import('./config.local.js');
  if (localModule?.AI_CONFIG_LOCAL) {
    Object.assign(AI_CONFIG, localModule.AI_CONFIG_LOCAL);
  }
} catch {
  // 在未创建本地私有配置（如全新克隆）的环境下静默降级，不阻断运行
}
