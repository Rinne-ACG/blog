# MEMORY.md — 长期记忆

## 项目信息

- **项目名称**：个人博客
- **技术栈**：React + TypeScript + Vite + Tailwind CSS + React Router
- **项目目录**：`D:\boke\blog`
- **GitHub 仓库**：Rinne-ACG/blog
- **部署平台**：Cloudflare Pages（`https://blog-c0r.pages.dev`）

## 腾讯云 OCR（ImageToExcelPage）

- **开发环境**：`vite.config.ts` 中间件使用 `tencentcloud-sdk-nodejs` 官方 SDK
- **关键修复**：中间件需将 SDK 返回包装为 `{ Response: data }`（SDK 直接返回裸数据，前端期望有 Response 层）
- **数据解析**：`XLSX.read(cleanB64, { type: 'base64', cellDates: true })`，其中 `cleanB64 = dataB64.replace(/[\s\r\n]/g, '')`
- **环境变量**：`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`（.env.local）
- **识别质量**：手写表格效果较好，印刷体表格有一定误识别（|→1, o→0, 逗号多余等）
- **生产环境**：`functions/api/tencent-ocr.ts` 需同步改为 SDK 方案（当前未修改）
