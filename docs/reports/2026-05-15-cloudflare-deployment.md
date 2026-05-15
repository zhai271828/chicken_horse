# Cloudflare 部署报告

日期：2026-05-15

## 已完成

- 创建并部署联机后端 Worker
- 修正 Durable Object 迁移配置，使其符合 Cloudflare 免费版 `new_sqlite_classes` 要求
- 创建前端 Pages 项目
- 使用正式 Worker `wss` 地址重新构建前端
- 上传前端静态资源到 Pages
- 验证 Worker 健康检查、Pages 主域访问、以及前端产物中的联机地址注入

## 线上地址

- Worker:
  - `https://chicken-horse-game.1056593143.workers.dev`
- Worker WebSocket 基地址:
  - `wss://chicken-horse-game.1056593143.workers.dev`
- Pages:
  - `https://chicken-horse-web.pages.dev`
- 本次部署预览地址:
  - `https://d8db105b.chicken-horse-web.pages.dev`

## 部署中修复的问题

- `workers/wrangler.toml` 原先使用 `new_classes = ["GameRoom"]`
- Cloudflare 免费版 Durable Object 线上要求改为 `new_sqlite_classes = ["GameRoom"]`
- 前端首次上传失败的原因是“构建”和“上传”并行执行，上传时 `dist` 尚未完整生成；顺序重传后已成功

## 验证结果

- `https://chicken-horse-game.1056593143.workers.dev/health` 返回 `{"status":"ok"}`
- `https://chicken-horse-web.pages.dev` 可正常访问
- 构建产物中已注入正式联机地址 `wss://chicken-horse-game.1056593143.workers.dev`

## 后续可选项

- 绑定自定义域名，例如：
  - 前端：`game.<你的域名>`
  - 联机后端：`ws.<你的域名>`
- 将 GitHub Actions 从 GitHub Pages 风格发布改成 Cloudflare Pages + Worker 自动发布
