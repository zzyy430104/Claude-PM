#!/usr/bin/env bash
# 备份数据库和上传的文档。用法：./scripts/backup.sh [备份目录]
# 需要在 docker-compose.yml 所在目录运行，服务处于启动状态。
set -euo pipefail
DIR="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"
docker compose exec -T db pg_dump -U pm --clean --if-exists claude_pm | gzip > "$DIR/db-$STAMP.sql.gz"
docker compose exec -T api tar czf - -C /data storage > "$DIR/storage-$STAMP.tgz"
( cd "$DIR" && sha256sum "db-$STAMP.sql.gz" "storage-$STAMP.tgz" > "SHA256-$STAMP.txt" )
echo "备份完成：$DIR/db-$STAMP.sql.gz  $DIR/storage-$STAMP.tgz"
