# 一步 / Yibu

一步是一个本地优先的 macOS 个人任务工作台。它不是团队看板，也不是复杂项目管理系统，而是一个帮助个人把今天要推进的事情放到眼前、拆成清单、持续完成的小桌面工具。

当前桌面应用名为“一步”，代码包名与仓库名使用 `yibu`。

## 下载

最新版本可以在 GitHub Releases 下载：

[下载最新版本](https://github.com/OneplumN/yibu/releases/latest)

当前提供 macOS Apple Silicon 安装包：

```text
yibu_0.1.5_aarch64.dmg
```

## 核心功能

- 今日执行：把今天最该推进的任务收进一个专注小窗。
- 小窗模式：主窗口可以直接收缩为今日执行窗口，再从同一窗口展开回主界面。
- 项目工作区：按项目管理任务、清单、状态、优先级和完成记录。
- 任务详情：编辑任务说明、检查清单、进度日志和状态。
- 报告中心：基于已完成任务生成日报/周报草稿，并支持配置 AI API。
- 本地数据：桌面端使用本地 SQLite，数据默认留在自己的电脑上。
- 导入导出：支持 JSON 快照导入和导出，方便备份迁移。

## 技术栈

- React 19 + TypeScript
- Vite 7
- Tauri 2 + Rust
- SQLite via `@tauri-apps/plugin-sql`
- Zustand
- Lucide React
- Vitest + Testing Library

## 本地开发

建议使用 Node.js 20.19+。

```bash
npm install
npm run dev
```

浏览器开发服务默认运行在：

```text
http://localhost:5173/
```

启动桌面开发版：

```bash
npm run tauri:dev
```

构建 macOS 桌面包：

```bash
npm run tauri:build
```

当前 Tauri 构建产物输出到：

```text
/tmp/yibu-tauri-target/release/bundle/macos/一步.app
/tmp/yibu-tauri-target/release/bundle/dmg/一步_0.1.5_aarch64.dmg
```

## 常用命令

```bash
npm run check        # TypeScript 类型检查
npm test             # 运行测试
npm run build        # 类型检查并构建前端生产包
npm run tauri:dev    # 启动 Tauri 桌面开发模式
npm run tauri:build  # 构建 Tauri 桌面包
```

## 数据说明

一步是本地优先应用，不会把用户数据提交进仓库。

- 桌面端使用 SQLite，本地数据库名为 `yibu.db`。
- Web 开发态使用浏览器 IndexedDB。
- 正式桌面包首次启动为空数据，不内置 demo 项目。
- 设置页提供完整数据快照的导入和导出。
- 导出默认不包含 AI API 密钥，跨设备迁移后需要重新配置。

以下内容属于本地数据或构建产物，已经加入 `.gitignore`：

```text
node_modules/
dist/
.local-data/
*.db
*.db-shm
*.db-wal
*.tsbuildinfo
release/
```

## 项目结构

```text
src/
  app/          # 应用壳、路由和桌面窗口入口
  components/   # 通用 UI、任务、项目、反馈组件
  features/     # 首页、项目、任务、报告、设置、今日执行
  lib/          # 存储、导入导出、AI、桌面窗口能力
  styles/       # 全局样式和视觉系统
  tests/        # 单元测试和组件测试
  types/        # 领域类型

src-tauri/
  capabilities/ # Tauri 权限配置
  icons/        # 桌面应用图标资源
  src/          # Tauri 启动和 SQLite 逻辑
```

设计方向见 [docs/DESIGN.md](./docs/DESIGN.md)。

## 发布

GitHub Actions 自动执行检查和发布：

- CI：每次 push / PR 自动跑类型检查、前端测试与构建，以及 macOS 原生数据库测试。
- Release：同步前端与 Tauri 版本号，推送 `v*` tag 后自动检查、测试、构建 DMG，再上传到 GitHub Release。
- 本地仍可运行 `npm run tauri:build` 生成安装包。

## 开发约定

- 保持本地优先，不提交用户数据、数据库、构建产物和本地快照。
- 纯图标按钮需要有清晰的 `aria-label`。
- 用户反馈统一使用轻量 toast。
- 涉及核心交互时补充测试。
- 发布前至少运行 `npm run check`、`npm test` 和 `npm run build`。
