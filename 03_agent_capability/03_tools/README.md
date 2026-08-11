# Tool 登记

Tool 表达**动作语义**（发现、抓取、查询、发布），不表达底层传输协议。

## 现行 Tool

| tool_id | 风险 | 说明 |
|---|---|---|
| `semantic.search` | read | 混合检索 |
| `source.discover` | read | 发现候选来源 |
| `source.capture` | write | 抓取并快照 |
| `source.query` | read | 按策略查询外部材料（可经 MCP/API/DB） |
| `artifact.publish` | external_side_effect | 发布正式制品 |

## 边界

```text
Evidence Research Skill
        ↓
source.query Tool
        ↓
MCP Adapter
        ↓
cninfo / datayes / htsc / china-policy ...
```

MCP 是连接协议，不是来源生产者；也不是 Tool 名本身。

## 维护

定义在本目录；执行绑定在 `06_runtime/src/capabilities/registry.ts`。
