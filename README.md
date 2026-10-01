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

## 已实现的功能（对标 ISO 22163:2023）

| 批次 | 内容 | 主要条款 |
|---|---|---|
| A 地基 | 多租户、登录（JWT + 一次性刷新令牌）、8 种角色、审计日志（数据库层只增不改） | 7.5 |
| B 计划层 | 项目与风险分级、阶段模板、项目管理计划与组织图、成员与任命、需求清单、WBS（阶段、交付物、成本科目、资源、外部供方、长周期）、依赖、关键路径、甘特图、计划批准与版本快照 | 8.1.3.1–8.1.3.5、8.1.3.7 |
| C 控制层 | 阶段关口评审（遗留问题、必选参与者、最高管理层授权）、项目评审、变更控制、风险与机会、问题与行动项 | 8.1.3.1、8.1.3.9、8.1.3.11、8.1.4.2 |
| D 质量与成本 | 成本科目与 EAC、项目质量计划、不符合项 / CAR 闭环、沟通计划与记录、培训 | 8.1.3.5、8.1.3.6、8.1.3.7、8.1.3.8 |
| E 支撑层 | 文档管理（标准目录、版本、校验和）、经验教训库与项目关闭、配置管理（PBS、配置基线） | 7.5、8.1.3.1.2、8.1.4.1 |
| F 收尾 | 项目组合仪表盘与待办、站内通知与邮件、审核证据包（ZIP + SHA-256 清单）、中英文界面、私有部署包 | 8.1.3.11、7.5 |
| 改造第一步 | 新界面风格（深蓝灰顶栏、深绿主色）、按工作组织的菜单、项目内 7 组导航（网址保留所在页）、可改名的职能角色、可改的系统名称；删除投标管理，新默认阶段（策划、技术准备、FAI、量产、交付、总结） | — |
| 加固 | 刷新令牌放 httpOnly Cookie、登录与注册限流、数据库行级安全（第二道租户隔离）、安全响应头 | — |

标准中的 shall 要求（上一阶段问题未关闭不能通过评审、计划批准后范围 / 预算 / 交期变更须经批准的变更申请、
变更实施前必须批准、审计记录不可篡改等）由后端强制执行，并有对应的自动化测试。

## 测试

```bash
cd apps/api && npm test && npm run test:e2e   # 单元测试 + 接口测试（需要 PostgreSQL 测试库）
cd apps/web && npm test                        # 前端单元测试
cd apps/web && npm run e2e                     # 浏览器端到端测试，见 apps/web/e2e/README.md
node scripts/smoke-test.mjs                    # 部署后的冒烟测试，见 docs/DEPLOY.md
```

## 文档

- [`docs/PLAN.md`](docs/PLAN.md)：总体方案
- [`docs/DEPLOY.md`](docs/DEPLOY.md)：部署、备份恢复、升级、安全检查清单与已知限制
