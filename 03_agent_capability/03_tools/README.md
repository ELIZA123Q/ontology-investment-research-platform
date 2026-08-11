# 工具登记 — 系统能执行哪些动作

> 上级目录：[`03_agent_capability/`](../README.md) | 根目录：[`README.md`](../../README.md)

Tool 表达**动作语义**（发现、抓取、查询、发布），不表达底层传输协议。好比工具箱里的工具——「搜索」「抓取」「发布」是动作名称，至于用 HTTP 还是 MCP 连接，是另一层的事。

## 里面有什么

| 工具 | 风险等级 | 一句话说明 |
|------|---------|-----------|
| `semantic.search` | 只读 | 混合检索已有知识 |
| `source.discover` | 只读 | 发现候选来源 |
| `source.capture` | 写入 | 抓取并快照来源内容 |
| `source.query` | 只读 | 按策略查询外部材料（可经 MCP/API/DB） |
| `artifact.publish` | 外部副作用 | 发布正式制品 |

## 调用链路

```
Evidence Research Skill（决定找什么）
        ↓
source.query Tool（执行查询动作）
        ↓
MCP Adapter（连接具体数据源）
        ↓
cninfo / datayes / htsc / china-policy ...
```

> MCP 是连接协议，不是来源生产者；也不是 Tool 名本身。

## 怎么维护

- 定义在本目录；执行绑定在 `06_runtime/src/capabilities/registry.ts`
