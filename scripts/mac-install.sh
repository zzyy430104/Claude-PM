#!/usr/bin/env bash
# Mac 一键安装：Homebrew → Colima + Docker 命令行（无界面）→ Claude-PM → 可选：让同一网络的同事访问
# 不设开机自动启动：需要时 bash scripts/mac-start.sh，用完 bash scripts/mac-stop.sh
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
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && ! colima status >/dev/null 2>&1; then
  ok "Docker 已经在运行（Docker Desktop / OrbStack），直接使用"
else
  for f in colima docker docker-compose; do
    brew list --formula "$f" >/dev/null 2>&1 || { echo "  安装 $f"; brew install "$f"; }
  done
  # 构建前端需要约 4 GB 内存；平时用 mac-start.sh 以 2 GB 启动
  colima status >/dev/null 2>&1 && colima stop
  echo "  启动 Colima 虚拟机（2 核 / 4 GB 内存 / 30 GB 硬盘，第一次需要几分钟）"
  EXTRA=()
  if [ "$ARCH" = "arm64" ] && [ "$MACOS_MAJOR" -ge 13 ] && [ ! -d ~/.colima/default ]; then EXTRA=(--vm-type vz --mount-type virtiofs); fi
  colima start --cpu 2 --memory 4 --disk 30 ${EXTRA[@]+"${EXTRA[@]}"}
  # 不设开机自动启动：需要时运行 scripts/mac-start.sh
  brew services stop colima >/dev/null 2>&1 || true
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

# ───────────── 5. 同事访问需要 socat 做本机端口转发（只在 mac-start.sh 启动时运行） ─────────────
if [ "$LAN" = 1 ]; then brew list --formula socat >/dev/null 2>&1 || brew install socat; fi
# 早期版本装过开机自动运行的转发，去掉
OLD="$HOME/Library/LaunchAgents/com.claude-pm.lan.plist"
if [ -f "$OLD" ]; then launchctl unload "$OLD" >/dev/null 2>&1 || true; rm -f "$OLD"; fi

# ───────────── 6. 清理构建缓存，按日常配置（2 GB 内存）重新启动 ─────────────
docker builder prune -f >/dev/null 2>&1 || true
say "按日常配置重新启动"
bash scripts/mac-stop.sh >/dev/null
bash scripts/mac-start.sh

say "安装完成"
echo "  用平台管理员登录（企业标识留空）→「租户管理」创建企业 → 用企业管理员登录。"
echo "  以后需要时：bash scripts/mac-start.sh    用完：bash scripts/mac-stop.sh"
