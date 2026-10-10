# 部署与运维手册

同一套代码支持云端（多租户 SaaS）和企业私有部署（通常单租户）。
本手册中的步骤都在真实的 Docker 环境里走通过：构建、启动、迁移、冒烟测试、浏览器端到端测试、备份恢复、重启后数据保留。

## 1. 环境要求

- Docker 24+ 与 Docker Compose v2
- 2 核 / 4 GB 内存起步；按人数选配置见下面的「容量与硬件」
- 对外提供 HTTPS 的反向代理（见第 5 节）
- 构建镜像时能访问 npm 仓库；内网环境请配置 npm 镜像，或在有网络的机器上构建好镜像后导入

### 容量与硬件（实测）

在 4 核 / 16 GB 的测试机上压测（同一台机器还跑着数据库和压测程序；测试企业 20 个项目，每个 40 个工作包）：

| 配置 | 普通页面接口 | 工作台汇总 |
|---|---|---|
| 1 个后台进程 | 约 210 次/秒，中位 48 毫秒 | 约 46 次/秒，中位 86 毫秒 |
| 3 个后台进程 | 约 436 次/秒，中位 24 毫秒 | 约 90 次/秒，中位 38 毫秒 |

按“在用的人大约每 30 秒打开一个页面、每页 5–8 次请求”估算，CPU 留四成余量：

| 企业规模（账号数） | 同时在用 | 建议配置 |
|---|---|---|
| 300 人以内 | 100 人以内 | 2 核 / 4 GB，应用和数据库同一台 |
| 300–1000 人 | 300 人以内 | 4 核 / 8 GB，`WORKERS=auto` |
| 1000–3000 人 | 1000 人以内 | 8 核 / 16 GB，或数据库单独一台 4 核 / 8 GB |

- `WORKERS`（`.env`）：后台进程数。`auto` 按 CPU 核数开（最多 8 个），每个进程约占 200 MB 内存；内存小的机器设 1 或 2。
- 多进程共用登录限流计数（存在数据库里），首次启动只由第一个进程创建平台管理员。
- 数据库连接：每个进程最多 10 个，8 个进程约 80 个，PostgreSQL 默认上限 100。


## 2. 首次部署

```bash
cp .env.example .env      # 修改所有 change-me，并设置 APP_URL
docker compose up -d --build
node scripts/smoke-test.mjs   # 见第 3 节
```

首次启动时会自动：

1. 创建数据库，并创建受限的应用账号 `pm_app`（见第 7 节，这是租户数据隔离生效的前提）；
2. 执行数据库迁移；
3. 按 `PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD` 创建平台管理员。

用平台管理员登录（企业标识留空），在「租户管理」里创建企业，即得到该企业的管理员账号。
登录后点右上角自己的名字进入「个人设置」修改密码，然后从 `.env` 中删除 `PLATFORM_ADMIN_PASSWORD`。
平台管理员建的企业管理员、企业管理员建的用户，首次登录都必须先修改密码；企业管理员可在「用户与角色」里为用户重置密码。

私有部署通常保持 `ALLOW_TENANT_SIGNUP=false`；云端要开放企业自助注册才设为 `true`。

### 在 Mac 上试用

```bash
bash scripts/mac-install.sh   # 第一次安装
bash scripts/mac-start.sh     # 需要时启动（启动 Docker 和程序，打开浏览器）
bash scripts/mac-stop.sh      # 用完关闭（释放内存，数据保留）
```

安装脚本按需安装 Homebrew、Colima（无界面的 Docker 虚拟机）和 Docker 命令行，然后调用 `scripts/install.sh`；
已经有 Docker Desktop 或 OrbStack 时直接用它。不设开机自动启动。构建时虚拟机用 4 GB 内存，日常启动用 2 GB。
选择让同事访问时，启动脚本用 socat 在本机 8090 端口做转发，同事用 `http://本机IP:8090` 访问；本机 IP 变了，启动脚本会自动更新访问地址。

## 3. 部署后验证（冒烟测试）

```bash
PM_URL=http://你的地址 PM_ADMIN_EMAIL=平台管理员邮箱 PM_ADMIN_PASSWORD=密码 node scripts/smoke-test.mjs
```

会创建两个 `smoke-*` 测试企业，走一遍核心链路：前端可访问和安全响应头、登录与刷新令牌 Cookie、
建项目、WBS 与关键路径、基线后的变更拦截、文档上传下载、审计日志、审核证据包、仪表盘、租户隔离，
最后把测试企业停用（数据保留，不会删除）。全部通过输出「全部通过」，任何一项失败会给出原因。

浏览器端到端测试见 `apps/web/e2e/README.md`（把 `WEB_URL` 和 `API_URL` 指向部署地址即可）。
注意 nginx 对 `/api/auth/` 有访问频率限制（每 IP 每分钟 30 次，突发 20 次），连续跑多个脚本时中间隔一分钟。

## 4. 配置项

| 变量 | 说明 |
|---|---|
| `POSTGRES_PASSWORD` | 数据库管理员账号 `pm` 的密码，仅用于迁移和备份（必填） |
| `APP_DB_PASSWORD` | 应用运行时使用的受限账号 `pm_app` 的密码（必填，首次初始化数据库时生效） |
| `JWT_SECRET` | 令牌签名密钥，用 `openssl rand -hex 32` 生成（必填） |
| `ALLOW_TENANT_SIGNUP` | 是否开放企业自助注册，默认 `false` |
| `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | 首次启动时创建平台管理员 |
| `APP_URL` | 站点对外地址，用于邮件中的链接 |
| `COOKIE_SECURE` | 站点走 https 时设为 `true`；纯 http 内网试运行设为 `false` |
| `WEB_PORT` | 对外端口，默认 8080 |
| `SMTP_URL` | 邮件通知，如 `smtp://user:pass@smtp.example.com:587`；留空则只发站内通知 |
| `MAIL_FROM` | 邮件发件人 |
| `MAX_UPLOAD_MB` | 单个上传文件大小上限，默认 25 |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL_DAYS` | 访问令牌有效期（默认 15m）与刷新令牌有效天数（默认 7） |
| `RATE_LIMIT_LOGIN_PER_ACCOUNT` / `_PER_IP` / `RATE_LIMIT_SIGNUP_PER_IP` | 登录失败次数上限（每 15 分钟，默认 8 / 60）与注册次数上限（每小时，默认 10） |
| `REQUIRE_RLS` | 已在 compose 中设为 `true`：数据库账号绕过行级安全时拒绝启动 |
| `AI_ALLOWED_HOSTS` | AI 接口地址允许的域名（逗号分隔，含子域名）；留空用内置清单（DeepSeek、通义千问、OpenAI、Kimi、智谱、火山方舟、千帆）。企业管理员只能填这些域名，防止服务器被用来访问内网 |
| `AI_ALLOW_PRIVATE` | 私有部署接内网模型时设为 `true`：允许 http 和内网地址（地址仍须在 `AI_ALLOWED_HOSTS` 里）；默认 `false` |
| `DATABASE_POOL_MAX` | 每个后台进程的数据库连接池大小，默认 10 |

## 5. HTTPS

容器内 nginx 只提供 HTTP。生产环境请在前面加一层反向代理并配置证书，同时把 `.env` 里的
`COOKIE_SECURE` 设为 `true`、`APP_URL` 改为 https 地址，例如：

```nginx
server {
  listen 443 ssl;
  server_name pm.example.com;
  ssl_certificate     /etc/ssl/pm.example.com.crt;
  ssl_certificate_key /etc/ssl/pm.example.com.key;
  client_max_body_size 30m;               # 略大于 MAX_UPLOAD_MB
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

## 6. 备份与恢复

需要备份两样东西：数据库（Docker 卷 `pgdata`）和上传的文档（Docker 卷 `storage`）。

```bash
./scripts/backup.sh /backup/claude-pm        # 生成 db-*.sql.gz、storage-*.tgz 和 SHA-256 校验文件
./scripts/restore.sh db-XXXX.sql.gz storage-XXXX.tgz    # 覆盖当前数据，需要输入 yes 确认
```

恢复已在测试环境验证：备份之后新建的企业和文件会消失，备份时的数据完整回来，
受限账号和行级安全策略保持不变，恢复后平台管理员可以正常登录。
建议每天备份并异地保存，定期演练恢复。审计日志在数据库里，随数据库一起备份。

## 7. 租户数据隔离（两道防线）

1. **业务代码**：每个查询都带 `tenantId` 条件，并有接口测试覆盖；
2. **数据库行级安全（RLS）**：所有带 `tenant_id` 的表都启用并强制了策略，数据库只放行当前请求所属租户的行。
   即使业务代码将来漏掉某个过滤条件，数据库也不会把别的企业的数据交出去。

第二道防线要求 API 用**普通账号**连接数据库。PostgreSQL 的超级用户和带 `BYPASSRLS` 的账号不受行级安全约束，
所以 compose 里迁移用 `pm`（超级用户），运行时用 `pm_app`（受限账号）；API 启动时检查账号，
发现能绕过行级安全就拒绝启动（`REQUIRE_RLS=true`）。

**已有数据库升级**：首次初始化脚本 `db/init/01-app-role.sh` 只在空数据库时执行。已有部署需要手工创建 `pm_app`：

```sql
CREATE ROLE pm_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE claude_pm TO pm_app;
GRANT USAGE ON SCHEMA public TO pm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pm IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pm IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pm_app;
```

并在 `.env` 里补上 `APP_DB_PASSWORD`。

## 8. 升级

```bash
git pull
./scripts/backup.sh
docker compose up -d --build     # API 启动时会自动执行数据库迁移
node scripts/smoke-test.mjs
```

## 9. 安全检查清单

- [ ] 所有 `change-me` 已替换，`.env` 不进入版本库
- [ ] 前面有 HTTPS，`COOKIE_SECURE=true`，数据库端口没有对外暴露（默认没有）
- [ ] `ALLOW_TENANT_SIGNUP` 符合预期
- [ ] 已配置定期备份并演练过恢复
- [ ] 平台管理员使用强密码，只有少数人持有，`PLATFORM_ADMIN_PASSWORD` 已从 `.env` 删除
- [ ] 冒烟测试全部通过

## 10. 登录与令牌的安全设计

- 访问令牌（15 分钟）只保存在浏览器内存里，页面刷新后由刷新令牌换回；
- 刷新令牌（7 天，一次性使用）只放在 httpOnly、SameSite=Strict 的 Cookie 里，页面脚本读不到；
  刷新接口还要求自定义请求头作为第二道跨站请求防线；
- 登录失败按账号和 IP 限次（进程内）；nginx 对 `/api/auth/` 再按 IP 限频；多实例部署时应用内的限次各实例独立计算；
- 停用用户或企业后，其访问令牌下一次请求即失效。

## 11. 已知限制

- 单点登录（OIDC / LDAP）和企业微信、钉钉、飞书对接尚未实现，登录目前只支持邮箱加密码。
  这两项需要对接客户自己的身份系统才能验证，建议拿到具体客户环境后再做。
- 英文界面通过词典翻译现有中文界面，界面新增文字需要同步补充 `apps/web/src/app/core/en.ts`；
  数据库里的用户录入内容（项目名称、描述等）不会被翻译。
- 内容安全策略允许内联样式（Angular Material 需要），脚本不允许内联。
- 应用内的登录限次是进程内计数，不跨实例。
