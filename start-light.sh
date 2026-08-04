#!/bin/bash
# ============================================================================
# 投研推理平台 - 轻量一键启动脚本
# 功能: 诊断端口 3000 -> 强杀残留/卡死进程 -> 检查有效生产构建 ->
#       有效则 prod:singleton(秒起) / 无效则 prod:rebuild(先构建再起) -> 轮询确认
# 用法: bash /Users/luyao/Documents/基于本体的投研推理平台/start-light.sh
#       (可在任意目录下运行, 脚本内含绝对路径)
# ============================================================================
set -u

RUNTIME_DIR="/Users/luyao/Documents/基于本体的投研推理平台/runtime"
PORT=3000
HOST="127.0.0.1"
LOG_FILE="/tmp/workbench-prod.log"

echo "==> [1/4] 诊断端口 $PORT ..."
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

echo "==> [2/4] 进入运行目录 & 检查生产构建 ..."
cd "$RUNTIME_DIR" || { echo "错误: 无法进入 $RUNTIME_DIR"; exit 1; }

# 关键修复: 仅判断 .next 目录存在是不够的, 必须存在非空的 BUILD_ID 才是有效生产构建。
# 否则 next start 会报 "Could not find a production build" 并立即退出(表现为双击打不开)。
if [ -s .next/BUILD_ID ]; then
  echo "    发现有效生产构建(BUILD_ID 存在), 直接启动(跳过构建)。"
  LAUNCH_CMD="npm run prod:singleton"
  MAX_WAIT=30
else
  echo "    ⚠ 未找到有效生产构建(.next/BUILD_ID 缺失/为空), 将自动执行 prod:rebuild(先 next build 再启动)。"
  echo "    构建为内存高峰且较慢(约数分钟), 请耐心等待, 期间尽量少开重型应用。"
  LAUNCH_CMD="npm run prod:rebuild"
  MAX_WAIT=600
fi

echo "==> [3/4] 后台启动: $LAUNCH_CMD ..."
# macOS 无 setsid, 用 nohup 忽略 SIGHUP, 关闭终端也不影响服务
nohup $LAUNCH_CMD > "$LOG_FILE" 2>&1 &
disown 2>/dev/null || true
echo "    已提交后台启动(日志: $LOG_FILE)"

echo "==> [4/4] 轮询等待服务就绪(最多 ${MAX_WAIT}s) ..."
for i in $(seq 1 "$MAX_WAIT"); do
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
  # 构建阶段每隔 30s 提示一次进度, 避免误以为卡死
  if [ "$LAUNCH_CMD" = "npm run prod:rebuild" ] && [ "$((i % 30))" -eq 0 ]; then
    echo "    (仍在构建/启动中, 已等待 ${i}s, 日志: $LOG_FILE)"
  fi
done

echo ""
echo "!! 启动超时(${MAX_WAIT}s 内未收到 HTTP 200). 请查看日志:"
echo "   tail -n 50 $LOG_FILE"
exit 1
