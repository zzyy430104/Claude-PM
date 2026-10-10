#!/bin/sh
# 首次初始化数据库时创建应用账号 pm_app。
#
# 为什么需要它：POSTGRES_USER（pm）是超级用户，超级用户不受行级安全约束。
# 迁移用 pm 执行；API 运行时用受限账号 pm_app 连接，这样数据库层的租户隔离才真正生效。
# pm 以后创建的表和序列，自动授予 pm_app 读写权限。
set -e

psql -v ON_ERROR_STOP=1 -v pw="$APP_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
CREATE ROLE pm_app LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE claude_pm TO pm_app;
GRANT USAGE ON SCHEMA public TO pm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pm IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pm IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pm_app;
EOSQL
