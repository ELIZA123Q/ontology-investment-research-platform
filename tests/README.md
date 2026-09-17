# 自动化测试

本目录覆盖本体、规则、方法登记、动态规划和执行、图仓储、审批与样例回放。CI 运行的是同一套 `pytest` 与 `ir-platform validate` 检查。

从仓库根目录运行：

```bash
uv sync --frozen
uv run --frozen --offline pytest
uv run --frozen --offline ir-platform validate
```

测试通过只证明当前实现满足已编码的约束；不证明某份历史投资判断正确，也不替代来源许可或公开发布审查。
