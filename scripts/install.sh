#!/usr/bin/env bash
# 一键部署：检查环境 → 生成配置（随机密码）→ 构建并启动 → 等待就绪 → 冒烟测试 → 打印登录信息。
#
# 用法（在项目根目录）：   bash scripts/install.sh
# 只生成配置不启动：       bash scripts/install.sh --no-start
# 非交互：可预先设置环境变量 PM_ADMIN_EMAIL、PM_ADMIN_PASSWORD、PM_APP_URL、PM_PORT
#
# 可以重复运行：已有 .env 时保留原配置，只重新构建和启动。
set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '  ✔ %s\n' "$*"; }
fail() { printf '\n\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
rand() { head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-24}"; }
getenv() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }

NO_START=0
[ "${1:-}" = "--no-start" ] && NO_START=1

# ───────────── 1. 检查环境 ─────────────
say "检查环境"
command -v docker >/dev/null 2>&1 || fail "没有安装 Docker。先运行：curl -fsSL https://get.docker.com | sudo sh   然后重新登录再运行本脚本"
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null || sudo -v 2>/dev/null; then DOCKER="sudo docker"; ok "当前用户没有 docker 权限，改用 sudo（以后可以运行 sudo usermod -aG docker \$USER 并重新登录）"
  else fail "无法连接 Docker：请确认 Docker 服务已启动（sudo systemctl start docker），并且你有权限使用它"; fi
fi
$DOCKER compose version >/dev/null 2>&1 || fail "需要 Docker Compose v2（docker compose 命令）。请升级 Docker，或安装 docker-compose-plugin"
ok "Docker：$($DOCKER --version)"

# ───────────── 2. 生成配置 ─────────────
say "准备配置文件 .env"
CREATED_ADMIN_PASSWORD=""
if [ -f .env ]; then
  ok "已有 .env，保留原来的配置"
else
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  PORT="${PM_PORT:-8080}"
  DEFAULT_URL="http://${IP:-localhost}:${PORT}"

  EMAIL="${PM_ADMIN_EMAIL:-}"
  if [ -z "$EMAIL" ]; then read -r -p "平台管理员登录邮箱 [admin@example.com]: " EMAIL || true; EMAIL="${EMAIL:-admin@example.com}"; fi

  PASS="${PM_ADMIN_PASSWORD:-}"
  if [ -z "$PASS" ]; then
    read -r -s -p "平台管理员密码（至少 8 位，直接回车则自动生成）: " PASS || true; echo
    if [ -z "$PASS" ]; then PASS="$(rand 16)"; CREATED_ADMIN_PASSWORD="$PASS"; fi
  fi
  [ "${#PASS}" -ge 8 ] || fail "密码至少 8 位"
  case "$PASS" in *[\$\#\"\'\\\ ]*) fail "密码里请不要包含 空格 \$ # 引号 反斜杠，会被配置文件误解析";; esac

  URL="${PM_APP_URL:-}"
  if [ -z "$URL" ]; then read -r -p "别人访问本系统用的地址 [$DEFAULT_URL]: " URL || true; URL="${URL:-$DEFAULT_URL}"; fi

  cat > .env <<EOF
POSTGRES_PASSWORD=$(rand 28)
APP_DB_PASSWORD=$(rand 28)
JWT_SECRET=$(rand 64)
ALLOW_TENANT_SIGNUP=false
PLATFORM_ADMIN_EMAIL=$EMAIL
PLATFORM_ADMIN_PASSWORD=$PASS
APP_URL=$URL
COOKIE_SECURE=$( [ "${URL#https://}" != "$URL" ] && echo true || echo false )
WEB_PORT=$PORT
SMTP_URL=
MAIL_FROM=Claude-PM <no-reply@example.com>
EOF
  chmod 600 .env
  ok "已生成 .env（数据库密码和签名密钥是随机生成的，权限 600）"
fi

if [ "$NO_START" = 1 ]; then echo; echo "已按 --no-start 停止，配置在 .env。"; exit 0; fi

# ───────────── 3. 构建并启动 ─────────────
say "构建并启动（第一次需要几分钟，请耐心等待）"
if ! $DOCKER compose up -d --build; then
  echo
  echo "构建或启动失败。常见原因："
  echo "  1. 无法访问 npm 或镜像仓库：检查网络，域名解析失败可在 /etc/docker/daemon.json 加 {\"dns\": [\"223.5.5.5\", \"114.114.114.114\"]} 后 sudo systemctl restart docker"
  echo "  2. 拉取镜像提示 429：Docker Hub 限流，先 docker login，或换镜像源"
  echo "  3. 端口被占用：改 .env 里的 WEB_PORT 后重新运行本脚本"
  fail "请把上面的报错发给开发者"
fi

# ───────────── 4. 等待就绪 ─────────────
say "等待服务就绪"
PORT="$(getenv WEB_PORT)"; PORT="${PORT:-8080}"
BASE="http://localhost:${PORT}"
READY=0
for _ in $(seq 1 60); do
  if curl -fsS "$BASE/api/health" 2>/dev/null | grep -q '"ok"'; then READY=1; break; fi
  sleep 2
done
if [ "$READY" != 1 ]; then
  echo "最近的 API 日志："; $DOCKER compose logs --tail 30 api || true
  fail "2 分钟内服务没有就绪，请把上面的日志发给开发者"
fi
ok "服务已就绪：$BASE"

# ───────────── 5. 冒烟测试 ─────────────
say "冒烟测试"
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then
  if PM_URL="$BASE" PM_ADMIN_EMAIL="$(getenv PLATFORM_ADMIN_EMAIL)" PM_ADMIN_PASSWORD="$(getenv PLATFORM_ADMIN_PASSWORD)" node scripts/smoke-test.mjs; then
    ok "冒烟测试通过"
  else
    echo "冒烟测试有失败项，请把上面的输出发给开发者（系统可能仍可使用）"
  fi
else
  echo "  没有安装 Node.js 18 以上，跳过冒烟测试；只检查了健康接口（已通过）。"
fi

# ───────────── 6. 结果 ─────────────
say "部署完成"
echo "  访问地址：$(getenv APP_URL)      （本机也可用 $BASE）"
echo "  平台管理员：$(getenv PLATFORM_ADMIN_EMAIL)"
if [ -n "$CREATED_ADMIN_PASSWORD" ]; then
  echo "  自动生成的密码：$CREATED_ADMIN_PASSWORD      ← 请现在记下来，登录后在「个人设置」里修改"
else
  echo "  密码：你刚才设置的（也保存在 .env 里）"
fi
echo
echo "  下一步：打开上面的地址，企业标识留空，用平台管理员登录，在「租户管理」里创建第一个企业。"
echo "  常用命令：查看状态  $DOCKER compose ps      查看日志  $DOCKER compose logs -f api      停止  $DOCKER compose down"
echo "  备份：bash scripts/backup.sh"
