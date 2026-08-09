# 证据语义与来源索引

这里回答「证据从哪证明、如何登记来源准入」，是证据语义的索引层，不存放完整取证操作手册副本。

## 给谁看

- **研究员**：查来源速查与证据相关入口
- **维护者**：保持本目录与取证库/本体模型的指针一致

## 材料从哪来

| 你要找的 | 去哪里 |
|---|---|
| 取证方法、来源速查 B00–B03、OPS 手册 | [`03_capabilities/05_method_libraries/03_取证/`](../../03_capabilities/05_method_libraries/03_取证/README.md) |
| MCP 通道注册与操作卡 | [`03_capabilities/04_protocols/mcp/`](../../03_capabilities/04_protocols/mcp/README.md) |
| 留痕操作说明 | [`02_tasks/04_workflows/deep_research/supporting/03_evidence_provenance_manual.md`](../../02_tasks/04_workflows/deep_research/supporting/03_evidence_provenance_manual.md) |
| 证据本体模型 | [`01_semantic/01_ontology/models/evidence.yaml`](../01_ontology/models/evidence.yaml) |
| 本目录索引 | [`registry.yaml`](./registry.yaml) |

本目录**不**保留 B00–OPS 实体副本，避免双权威。

## 怎么用

1. 先明确要证明什么 → 用取证方法库选方法。
2. 再决定去哪找 → 用来源速查 + MCP OPS（注意：MCP 是通道，不是生产者）。
3. 写入正式证据前必须能核验原文；无合格证据时判断应降级。

## 怎么维护

- 只维护 provenance / 来源准入索引与指针；正文仍在取证库与协议目录。
- 路径变更时同步改 `registry.yaml` 与上游 README 链接。
- 未经 Source Capture 不得形成 EvidenceFact（执行层由 Runtime 保障）。

---

## 维护者附录（可跳过）

- 本目录是索引壳；权威操作正文在方法库 03 与 MCP 协议目录
