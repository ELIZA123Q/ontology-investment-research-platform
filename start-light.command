#!/bin/bash
# 双击本文件即可启动投研推理平台(轻量模式)
# 本文件只是入口, 真正逻辑在 start-light.sh
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy 2>/dev/null || true
unset SOCKS_PROXY SOCKS5_PROXY socks_proxy socks5_proxy 2>/dev/null || true
exec bash "/Users/luyao/Documents/基于本体的投研推理平台/start-light.sh"
