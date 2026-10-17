# SleepIn Web Edition 课程表应用

> 基于开源安卓项目 [Kurosu-Ti01/SleepIn](https://github.com/Kurosu-Ti01/SleepIn) 完整重构的现代纯前端静态网页应用（PWA）。

## 🌟 核心特性

- 📱 **PWA 与 iPhone 全屏支持**：配置完整的 `manifest.json` 与 iOS Safari `apple-mobile-web-app-capable`，支持在 iPhone 上“添加到主屏幕”，无地址栏全屏沉浸体验。
- 📐 **灵动岛与刘海屏安全区域适配**：全面适配 iPhone Dynamic Island、Notch 及底部 Home Indicator 手势指示条（采用 `viewport-fit=cover` 与 `env(safe-area-inset-*)`）。
- 🎨 **Material Design 3 原生体验**：完整复刻原版 SleepIn 的色彩系统、深浅色主题切换、流体云（Fluid Cloud）提醒胶囊与抽屉卡片。
- 💾 **纯前端离线持久化**：使用浏览器 `IndexedDB` 存储课表、作息表、课程和上课时段数据，搭配 `localStorage` 双重容灾，完全不需要后端服务。
- 📅 **周课表与日历联动**：
  - 自动根据开学日期计算当前学期周数及进度状态（“学期未开始”、“学期已结束”）。
  - 周视图支持触屏左右滑动手势切周、上下惯性滚动。
  - 实时红色横线指示当前时刻在作息课节中的位置。
  - 支持高亮今日、半透明显示非本周课程。
- 🔔 **上课提醒与提示音**：
  - 支持提前 5/10/15/20/30 分钟提醒。
  - 迁移并内置清脆舒缓的二和弦铃声，支持 Web Audio API 零延迟合成与音频播放。
  - 支持浏览器 Notification 桌面/横幅通知及应用内动态灵动岛提示胶囊。
- ⚡ **作息表一键智能生成**：
  - 设定首节上课时间、课时时长、课间时长、总课节数，一键自动排定全天课表。
- 🔍 **上课时间冲突检测**：
  - 智能排查同星期、时间段交叉及周次重叠（单双周/全周/自定义周），提供冲突拦截与强制保存选项。
- 📊 **CSV 导入导出与数据备份**：
  - 支持原版 SleepIn 标准的课程表 CSV 与作息表 CSV 导入导出。
  - 兼容单列周次高级语法（如 `1-16`, `1;3;5`, `1-16(odd)`, `1-16(even)`）及传统周次字段。
  - 支持导出与恢复完整 JSON 数据备份文件。

---

## 🚀 GitHub Pages 部署指南

本应用为纯前端静态应用，不需要任何服务端运行时，直接部署即可：

### 方式一：直接使用 GitHub Pages 托管仓库
1. 将当前项目推送到 GitHub 仓库的 `main` 或 `master` 分支。
2. 进入仓库 **Settings -> Pages**。
3. **Build and deployment -> Source** 选择 **Deploy from a branch**。
4. Branch 选择 `main` 或 `master`，路径选择 `/web-app`（或 `/ (root)`）。
5. 保存后访问分配的 `https://<用户名>.github.io/<仓库名>/web-app/` 即可。

### 方式二：部署到独立分支（如 `gh-pages`）
将 `web-app` 文件夹内的全部内容推送到 `gh-pages` 分支的根目录，即可通过 `https://<用户名>.github.io/<仓库名>/` 直接访问。

---

## 📲 在 iPhone 上全屏使用（添加到主屏幕）

1. 在 iPhone 上使用 **Safari 浏览器** 打开本网页。
2. 点击屏幕底部的 **“分享”** 按钮（方框带向上箭头图标）。
3. 向上滑动菜单，找到并点击 **“添加到主屏幕”**。
4. 点击右上角 **“添加”**。
5. 返回 iPhone 桌面，点击 **SleepIn** 图标即可享受无浏览器地址栏的原生 App 全屏体验。

---

## 📂 目录结构说明

```text
web-app/
├── index.html              # 应用单页入口（含 PWA 与安全区域 Meta）
├── manifest.json           # Web App Manifest 配置
├── sw.js                   # Service Worker 离线缓存脚本
├── css/
│   └── style.css           # Material 3 样式、安全区域适配与交互动画
├── js/
│   ├── app.js              # 主控制器与视图状态绑定（MVVM）
│   ├── db.js               # IndexedDB 本地数据存储与默认数据播种
│   ├── csv.js              # 课程表/作息表 CSV 导入导出解析引擎
│   ├── conflict.js         # 课程上课时间冲突检测器
│   ├── reminder.js         # 课程提醒引擎与提示音频合成
│   └── theme.js            # 主题模式与颜色工具
├── assets/
│   ├── audio/              # 上课提示音资源 (reminder.wav)
│   └── images/             # 官方 Logo 与界面插图
└── icons/                  # PWA 各分辨率图标与 Apple Touch Icon
```
