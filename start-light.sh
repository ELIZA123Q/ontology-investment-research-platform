#!/bin/bash
# ============================================================================
# 投研推理平台 - 轻量一键启动脚本
# 功能: 诊断端口 3000 状态 -> 强杀残留/卡死进程 -> 后台启动 prod:singleton -> 轮询确认
# 用法: bash /Users/luyao/Documents/基于本体的投研推理平台/start-light.sh
#       (可在任意目录下运行, 脚本内含绝对路径)
# ============================================================================
set -u

RUNTIME_DIR="/Users/luyao/Documents/基于本体的投研推理平台/runtime"
PORT=3000
HOST="127.0.0.1"
LOG_FILE="/tmp/workbench-prod.log"

echo "==> [1/3] 诊断端口 $PORT ..."
if lsof -iTCP:$PORT -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://$HOST:$PORT/" 2>/dev/null)
  if [ "$code" = "000" ] || [ -z "$code" ]; then
    echo "    发现卡死进程(端口 LISTEN 但 HTTP=$code), 强制清理 ..."
  else
    echo "    发现正常运行进程(HTTP=$code), 准备重启 ..."
  fi
  killed=0
  for pid in $(lsof -tiTCP:$PORT -sTCP:LISTEN); do
    kill -9 "$pid" 2>/dev/null && { echo "    已强杀 PID $pid"; killed=1; }
  done
  if [ "$killed" -eq 0 ]; then
    echo "    未能获取端口占用 PID(可能权限不足), 请手动检查。"
  fi
  sleep 2
else
  echo "    端口空闲, 无需清理。"
fi

echo "==> [2/3] 后台启动 prod:singleton ..."
cd "$RUNTIME_DIR" || { echo "错误: 无法进入 $RUNTIME_DIR"; exit 1; }
# macOS 无 setsid, 用 nohup 忽略 SIGHUP, 关闭终端也不影响服务
nohup npm run prod:singleton > "$LOG_FILE" 2>&1 &
disown 2>/dev/null || true
echo "    已提交后台启动(日志: $LOG_FILE)"

echo "==> [3/3] 轮询等待服务就绪 ..."
for i in $(seq 1 30); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://$HOST:$PORT/" 2>/dev/null)
  if [ "$code" = "200" ]; then
    echo ""
    echo "=========================================="
    echo " 启动成功! HTTP 200"
    echo " 访问地址: http://$HOST:$PORT/"
    echo " 日志文件: $LOG_FILE"
    echo "=========================================="
    exit 0
  fi
done

echo ""
echo "!! 启动超时(30s 内未收到 HTTP 200). 请查看日志:"
echo "   tail -n 50 $LOG_FILE"
exit 1
