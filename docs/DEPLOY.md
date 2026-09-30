# 部署与运维手册

同一套代码支持云端（多租户 SaaS）和企业私有部署（通常单租户）。

## 1. 环境要求

- Docker 24+ 与 Docker Compose v2
- 2 核 / 4 GB 内存起步（30–200 人规模）；2000 人规模建议 4 核 / 8 GB，数据库单独部署
- 对外提供 HTTPS 的反向代理（见第 4 节）

## 2. 首次部署

```bash
cp .env.example .env      # 修改所有 change-me，并设置 APP_URL
docker compose up -d --build
curl http://localhost:8080/api/health      # 返回 {"status":"ok"}
```

首次启动时，按 `PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD` 创建平台管理员。
用它登录（企业标识留空），在「租户管理」里创建企业，即得到该企业的管理员账号。
登录后请立即修改初始密码，并从 `.env` 中删除 `PLATFORM_ADMIN_PASSWORD`。

私有部署通常保持 `ALLOW_TENANT_SIGNUP=false`；云端要开放企业自助注册才设为 `true`。

## 3. 配置项

| 变量 | 说明 |
|---|---|
| `POSTGRES_PASSWORD` | 数据库密码（必填） |
| `JWT_SECRET` | 令牌签名密钥，用 `openssl rand -hex 32` 生成（必填） |
| `ALLOW_TENANT_SIGNUP` | 是否开放企业自助注册，默认 `false` |
| `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | 首次启动时创建平台管理员 |
| `APP_URL` | 站点对外地址，用于邮件中的链接 |
| `SMTP_URL` | 邮件通知，如 `smtp://user:pass@smtp.example.com:587`；留空则只发站内通知 |
| `MAIL_FROM` | 邮件发件人 |
| `MAX_UPLOAD_MB` | 单个上传文件大小上限，默认 25 |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL_DAYS` | 访问令牌有效期（默认 15m）与刷新令牌有效天数（默认 7） |

## 4. HTTPS

容器内 nginx 只提供 HTTP（端口 8080）。生产环境请在前面加一层反向代理并配置证书，例如：

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
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

## 5. 备份与恢复

需要备份两样东西：数据库（Docker 卷 `pgdata`）和上传的文档（Docker 卷 `storage`）。

```bash
./scripts/backup.sh /backup/claude-pm        # 生成 db-*.sql.gz、storage-*.tgz 和校验文件
./scripts/restore.sh db-XXXX.sql.gz storage-XXXX.tgz
```

建议每天备份并异地保存，定期在测试环境演练恢复。审计日志在数据库里，随数据库一起备份。

## 6. 升级

```bash
git pull
./scripts/backup.sh
docker compose up -d --build     # API 启动时会自动执行数据库迁移
```

## 7. 安全检查清单

- [ ] 所有 `change-me` 已替换，`.env` 不进入版本库
- [ ] 前面有 HTTPS，数据库端口没有对外暴露（默认没有）
- [ ] `ALLOW_TENANT_SIGNUP` 符合预期
- [ ] 已配置定期备份并演练过恢复
- [ ] 平台管理员使用强密码，只有少数人持有

## 8. 已知限制

- 单点登录（OIDC / LDAP）和企业微信、钉钉、飞书对接尚未实现，登录目前只支持邮箱加密码。
- 前端把访问令牌和刷新令牌保存在浏览器 `localStorage`，一旦页面出现跨站脚本漏洞令牌可能被窃取；
  后续应改为 httpOnly Cookie。
- 租户数据隔离依赖后端代码逐处校验，尚未在数据库层启用行级安全（RLS）作为第二道防线。
- 英文界面通过词典翻译现有中文界面，界面新增文字需要同步补充 `apps/web/src/app/core/en.ts`。
- 数据库里的用户录入内容（项目名称、描述等）不会被翻译。
