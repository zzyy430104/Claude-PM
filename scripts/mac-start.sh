#!/usr/bin/env bash
# Mac：需要时启动 Claude-PM（先启动 Docker，再启动程序；开放给同事时同时启动端口转发）
# 用法（在项目根目录）：bash scripts/mac-start.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ok()   { printf '  ✔ %s\n' "$*"; }
fail() { printf '\n\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)" && break; done

[ -f .env ] || fail "还没有安装，请先运行：bash scripts/mac-install.sh"
getenv() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
PORT="$(getenv WEB_PORT)"; PORT="${PORT:-8080}"
LAN_PORT=8090
PIDFILE="$HOME/.claude-pm-lan.pid"

# 1. Docker
wait_docker() { for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }
if docker info >/dev/null 2>&1; then
  ok "Docker 已在运行"
elif command -v colima >/dev/null 2>&1; then
  echo "  启动 Colima 虚拟机（约半分钟）"
  colima start --memory 2 >/dev/null
  wait_docker || fail "Colima 没有启动成功，请运行 colima status 并把输出发给开发者"
  ok "Docker 已启动（Colima，2 GB 内存）"
elif [ -d /Applications/OrbStack.app ] || [ -d /Applications/Docker.app ]; then
  [ -d /Applications/OrbStack.app ] && open -a OrbStack || open -a Docker
  echo "  等待 Docker 启动"
  wait_docker || fail "Docker 2 分钟内没有启动"
  ok "Docker 已启动"
else
  fail "没找到 Docker，请先运行：bash scripts/mac-install.sh"
fi

# 2. 开放给同事时，IP 变了就更新访问地址
URL="$(getenv APP_URL)"
LAN=0
case "$URL" in *":$LAN_PORT"*) LAN=1;; esac
if [ "$LAN" = 1 ]; then
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  if [ -n "$IP" ] && [ "$URL" != "http://$IP:$LAN_PORT" ]; then
    perl -pi -e "s#^APP_URL=.*#APP_URL=http://$IP:$LAN_PORT#" .env
    URL="http://$IP:$LAN_PORT"
    ok "本机 IP 变了，访问地址更新为 $URL"
  fi
fi

# 3. 程序（配置有变化时会自动按新配置重建容器）
docker compose up -d >/dev/null
for _ in $(seq 1 60); do curl -fsS "http://localhost:$PORT/api/health" 2>/dev/null | grep -q '"ok"' && break; sleep 2; done
curl -fsS "http://localhost:$PORT/api/health" 2>/dev/null | grep -q '"ok"' || { docker compose logs --tail 30 api || true; fail "程序 2 分钟内没有就绪，请把上面的日志发给开发者"; }
ok "Claude-PM 已启动：http://localhost:$PORT"

# 4. 同事访问：本机端口转发
if [ "$LAN" = 1 ]; then
  command -v socat >/dev/null 2>&1 || brew install socat
  [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null || true
  nohup socat "TCP-LISTEN:$LAN_PORT,fork,reuseaddr" "TCP:127.0.0.1:$PORT" >/dev/null 2>&1 &
  echo $! > "$PIDFILE"
  sleep 1
  if curl -fsS "http://127.0.0.1:$LAN_PORT/api/health" >/dev/null 2>&1; then ok "同事访问地址：$URL"
  else echo "  同事访问的端口转发没有响应，请把这段输出发给开发者"; fi
  echo "  如果 macOS 弹窗问是否允许 socat 接受网络连接，请选“允许”。"
fi

open "http://localhost:$PORT" 2>/dev/null || true
echo "  用完请运行：bash scripts/mac-stop.sh"
