# 语义知识域

> 还不了解本项目？先读仓库根目录 [新手导读.md](../新手导读.md)。

这里回答「系统如何理解世界」：用哪些概念、统一叫什么、对象之间是什么关系、证据从哪证明。

**不负责**「怎么做一次研究」（那是任务域与 Runtime）。

## 给谁看

- **研究员**：查名词、证据来源速查、理解「系统认什么事实」
- **维护者**：改本体/词典/图合同后的登记与校验

## 材料从哪来

| 子目录 | 白话含义 | 权威位置 |
|---|---|---|
| [`01_ontology/`](01_ontology/README.md) | 世界里有哪些对象与规则 | 本目录下 ontology 正文与 `platform_registry.yaml` |
| [`02_dictionary/`](02_dictionary/README.md) | 同一概念的标准叫法 | 词典条目文件 |
| [`03_knowledge_graph/`](03_knowledge_graph/README.md) | 关系怎么存、两套图为何不混 | 图合同与说明 |
| [`04_evidence/`](04_evidence/README.md) | 证据材料从哪来、如何留痕 | 来源速查 B00–B02 等 |

总登记见 [`registry.yaml`](./registry.yaml)。跨域「权威在哪」见 [`five_domain_authority.yaml`](../05_governance/01_架构/five_domain_authority.yaml)。

## 怎么用

1. 先明确你是要查**概念定义**（ontology/dictionary）、**关系结构**（knowledge_graph），还是**证据从哪找**（evidence）。
2. 打开对应子目录 README，按「最短路径」进正文。
3. 做研究时：证据通道与操作手册在 [`03_capabilities/04_protocols/mcp/`](../03_capabilities/04_protocols/mcp/README.md)；本域的 `04_evidence` 侧重「证据语义与来源速查」。

## 怎么维护

- 新增或修改正式语义对象：写入本域对应子目录，并更新本域/`子域` registry。
- 改完跑项目与本体相关校验（见 [`05_governance/03_校验/`](../05_governance/03_校验/README.md) 与 ontology 子目录说明）。
- 不要在 Runtime 里另写一套「平行本体」；Runtime 只消费登记过的语义。

---

## 维护者附录（可跳过）

| 项 | 值 |
|----|----|
| status | `active` |
| write_entry | `01_semantic/` |
| 上位 | [`00_五域系统骨架.md`](../05_governance/01_架构/00_五域系统骨架.md) |
| 权威查找顺序 | five_domain_authority → 本域 registry → 子域 registry |
