#!/usr/bin/env bash
# 恢复备份（会覆盖现有数据！）。用法：./scripts/restore.sh db-XXXX.sql.gz storage-XXXX.tgz
set -euo pipefail
[ $# -eq 2 ] || { echo "用法：$0 <数据库备份.sql.gz> <文档备份.tgz>"; exit 1; }
read -r -p "这会覆盖当前数据库和文档，确认继续？输入 yes：" ok
[ "$ok" = "yes" ] || { echo "已取消"; exit 1; }
docker compose stop api
gunzip -c "$1" | docker compose exec -T db psql -U pm -d claude_pm
docker compose run --rm --no-deps -T -u root api sh -c 'rm -rf /data/storage/* && tar xzf - -C /data' < "$2"
docker compose start api
echo "恢复完成"
