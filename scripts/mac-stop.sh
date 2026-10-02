#!/usr/bin/env bash
# Mac：用完关闭 Claude-PM，释放内存和 CPU（数据保留，下次 mac-start.sh 接着用）
# 用法（在项目根目录）：bash scripts/mac-stop.sh
set -uo pipefail
cd "$(dirname "$0")/.."
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)" && break; done

PIDFILE="$HOME/.claude-pm-lan.pid"
if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null; rm -f "$PIDFILE"; echo "  ✔ 已关闭同事访问"; fi

if docker info >/dev/null 2>&1; then
  docker compose stop >/dev/null 2>&1 && echo "  ✔ 已停止 Claude-PM"
fi

if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
  colima stop >/dev/null 2>&1 && echo "  ✔ 已关闭 Colima 虚拟机，内存已释放"
elif docker info >/dev/null 2>&1; then
  echo "  Docker Desktop / OrbStack 仍在运行；不用别的容器时可以在菜单栏退出它。"
fi
echo "  数据都保留着，下次运行 bash scripts/mac-start.sh 即可。"
