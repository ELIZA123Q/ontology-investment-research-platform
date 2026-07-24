# 工作区记忆

## 03阶段金融MCP数据源
- 15+金融MCP已注册到03取证阶段：通联全系列（股票/基金/指数/宏观）、cninfo（巨潮）、htsc_research（华泰研报）、china-policy（中央政策）、caixin-news（财新）、jina-reader（网页获取）
- MCP配置在 `~/.workbuddy/mcp.json`（用户级），项目级不存储密钥
- MCP通道注册：`methods/03_取证/B03_MCP通道注册.md`
- MCP操作参考：`methods/03_取证/OPS_MCP查询快速参考.md`（QP-MCP-*编号）
- 核心原则：MCP是获取通道，不是来源生产者（B00/03规范2.5节）
- 验证：`python3 methods/03_取证/validate_03.py` ← 修改后需重新验证
- validate_03.py修改要点：B文件允许B03存在、OPS文件允许第4个、QP_PATTERN支持QP-MCP-*
- `.workbuddy/project.md` 在打开项目时自动注入MCP清单到AI上下文

## 项目运行
- 运行时：`cd runtime && npm run dev:singleton` → `http://127.0.0.1:3000`
- 后台Worker：`npm run worker`
- Python验证使用 managed Python：`/Users/luyao/.workbuddy/binaries/python/versions/3.13.12/bin/python3`
