# Claude-PM

面向轨道交通供应商、对标 ISO 22163:2023 的项目管理与质量协同平台。

- 需求与方案：见 [`docs/PLAN.md`](docs/PLAN.md)
- 技术栈：Angular + NestJS + PostgreSQL（Prisma），全程 TypeScript

## 目录

| 路径 | 说明 |
|---|---|
| `apps/api` | NestJS 后端 |
| `apps/web` | Angular 前端 |
| `docker-compose.yml` | 私有部署 / 本地一键启动（数据库 + API） |

## 后端开发

```bash
cd apps/api
cp .env.example .env            # 修改 DATABASE_URL、JWT_SECRET
npm install
npx prisma migrate dev          # 建库并应用迁移
npm run start:dev
npm run test:e2e                # 需要可连接的 PostgreSQL 测试库，见 vitest.config.e2e.ts
```

## 前端开发

```bash
cd apps/web
npm install
npx ng serve                    # http://localhost:4200，/api 代理到 localhost:3000
npm test
```

## Docker 部署

```bash
cp .env.example .env            # 修改所有 change-me
docker compose up -d
curl localhost:8080/api/health   # 浏览器访问 http://localhost:8080
```

## 批次 A（地基）已实现

- 多租户：所有租户数据按 `tenant_id` 隔离，跨租户访问返回 404
- 登录：JWT 访问令牌 + 一次性刷新令牌；停用用户 / 租户后令牌立即失效
- 角色权限：8 种角色，后端强制校验
- 审计日志：数据库触发器禁止修改和删除（R8）
- 平台管理员创建租户；可选的租户自助注册（`ALLOW_TENANT_SIGNUP`）
