#!/usr/bin/env bash
# Mac 一键安装：Homebrew → Colima + Docker 命令行（无界面）→ Claude-PM → 可选：让同一网络的同事访问
#
# 用法（在项目根目录）：   bash scripts/mac-install.sh
# 已经装了 Docker Desktop 或 OrbStack 且正在运行时，直接用它，不再装 Colima。
# 可以重复运行：已经装好的部分会跳过。
set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '  ✔ %s\n' "$*"; }
fail() { printf '\n\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "这个脚本只用于 Mac；Linux 服务器请用 scripts/install.sh"
ARCH="$(uname -m)"
MACOS_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"

# ───────────── 1. Homebrew ─────────────
say "检查 Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)" && break; done
fi
if ! command -v brew >/dev/null 2>&1; then
  echo "  没有 Homebrew，现在安装（会要求输入本机开机密码）"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)" && break; done
  command -v brew >/dev/null 2>&1 || fail "Homebrew 安装失败，请把上面的输出发给开发者"
  # 以后打开终端也能直接用 brew
  grep -q 'brew shellenv' ~/.zprofile 2>/dev/null || echo "eval \"\$($(command -v brew) shellenv)\"" >> ~/.zprofile
fi
ok "Homebrew：$(brew --version | head -1)"

# ───────────── 2. Docker ─────────────
say "检查 Docker"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "Docker 已经在运行，直接使用"
else
  for f in colima docker docker-compose; do
    brew list --formula "$f" >/dev/null 2>&1 || { echo "  安装 $f"; brew install "$f"; }
  done
  if ! colima status >/dev/null 2>&1; then
    echo "  启动 Colima 虚拟机（2 核 / 4 GB 内存 / 30 GB 硬盘，第一次需要几分钟）"
    EXTRA=()
    if [ "$ARCH" = "arm64" ] && [ "$MACOS_MAJOR" -ge 13 ]; then EXTRA=(--vm-type vz --mount-type virtiofs); fi
    colima start --cpu 2 --memory 4 --disk 30 ${EXTRA[@]+"${EXTRA[@]}"}
  fi
  brew services start colima >/dev/null 2>&1 || true   # 开机自动启动
  docker info >/dev/null 2>&1 || fail "Docker 没有启动成功，请运行 colima status 并把输出发给开发者"
  ok "Docker 已就绪（Colima）"
fi
if ! docker compose version >/dev/null 2>&1; then
  brew list --formula docker-compose >/dev/null 2>&1 || brew install docker-compose
  mkdir -p ~/.docker/cli-plugins
  ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose
fi
docker compose version >/dev/null 2>&1 || fail "docker compose 不可用，请把上面的输出发给开发者"
ok "$(docker compose version)"

# ───────────── 3. 访问方式 ─────────────
PORT="${PM_PORT:-8080}"
LAN_PORT=8090
LAN=0
if [ ! -f .env ]; then
  say "访问方式"
  read -r -p "同一网络的同事也要访问吗？[y/N]: " ans || true
  case "${ans:-n}" in y|Y|yes|YES) LAN=1;; esac
  if [ "$LAN" = 1 ]; then
    IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
    [ -n "$IP" ] || fail "没取到本机 IP，请确认已连上网络"
    export PM_APP_URL="http://$IP:$LAN_PORT"
  else
    export PM_APP_URL="http://localhost:$PORT"
  fi
  export PM_PORT="$PORT"
elif grep -q ":$LAN_PORT" .env; then
  LAN=1
fi

# ───────────── 4. 安装 Claude-PM ─────────────
say "安装 Claude-PM"
bash scripts/install.sh

# ───────────── 5. 同事访问：本机端口转发（开机自动运行） ─────────────
if [ "$LAN" = 1 ]; then
  say "开放给同一网络的同事"
  brew list --formula socat >/dev/null 2>&1 || brew install socat
  PLIST="$HOME/Library/LaunchAgents/com.claude-pm.lan.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.claude-pm.lan</string>
  <key>ProgramArguments</key><array>
    <string>$(brew --prefix)/bin/socat</string>
    <string>TCP-LISTEN:$LAN_PORT,fork,reuseaddr</string>
    <string>TCP:127.0.0.1:$PORT</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
EOF
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl load "$PLIST"
  sleep 1
  if curl -fsS "http://127.0.0.1:$LAN_PORT/api/health" >/dev/null 2>&1; then ok "同事访问地址：$(grep -E '^APP_URL=' .env | cut -d= -f2-)"
  else echo "  端口转发没有响应，请把这段输出发给开发者"; fi
  echo "  如果 macOS 弹窗问是否允许 socat 接受网络连接，请选“允许”。"
  echo "  Mac 换了网络、IP 变了以后，改 .env 里的 APP_URL 再运行一次本脚本。"
fi

# ───────────── 6. 清理构建缓存 ─────────────
docker builder prune -f >/dev/null 2>&1 || true

say "完成"
echo "  本机打开：http://localhost:$PORT"
echo "  用平台管理员登录（企业标识留空）→「租户管理」创建企业 → 用企业管理员登录。"
echo "  试用期间请设置接通电源时不睡眠：系统设置 → 电池（或节能）。"
