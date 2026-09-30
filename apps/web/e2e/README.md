# 浏览器端到端测试

用真实浏览器走完整业务流程，与 `apps/api/test` 里的接口测试互补。每个脚本对应一个交付批次：

| 脚本 | 覆盖 |
|---|---|
| `batchA.mjs` | 注册、登录、角色菜单、路由拦截、审计日志 |
| `batchB.mjs` | 项目、阶段、成员、WBS、依赖、关键路径、甘特图、基线 |
| `batchC.mjs` | 关口评审、变更控制全流程、风险、问题、项目评审 |
| `batchD.mjs` | 成本、质量计划、不符合项闭环、沟通与培训 |
| `batchE.mjs` | 文档上传与版本、配置管理、经验教训、投标转项目 |
| `batchF.mjs` | 仪表盘与待办、通知、审核证据包下载 |
| `i18nscan.mjs` | 英文界面下扫描各页面，列出未翻译的中文 |

## 运行

```bash
# 1. 启动后端和数据库（需要 PostgreSQL，见 ../../api/README 与根目录 README）
cd apps/api && npm run build && ALLOW_TENANT_SIGNUP=true node dist/main &
# 2. 启动前端
cd apps/web && npx ng serve &
# 3. 运行
cd apps/web && npm install && npm run e2e
```

环境变量：`WEB_URL`（默认 http://localhost:4200）、`API_URL`（默认 http://localhost:3000）、
`CHROMIUM_PATH`（浏览器可执行文件；不设则用 Playwright 安装的浏览器）。

脚本每次会用随机的企业标识自动建数据，可重复运行。登录一律走真实的登录表单（令牌只在内存和 httpOnly Cookie 里）。

## 对着已部署的站点运行

```bash
# 需要站点开启企业自助注册（ALLOW_TENANT_SIGNUP=true），脚本用它来建测试企业
WEB_URL=http://你的地址 API_URL=http://你的地址/api node e2e/batchC.mjs
```

nginx 对 `/api/auth/` 有访问频率限制（每 IP 每分钟 30 次，突发 20 次）。
连续跑多个脚本时，每个之间隔约一分钟，否则登录会被限流而误报失败。
