# Rules

这里回答「系统必须遵守什么规则」。只保存由 Control Plane 拥有的公共约束、阈值和知识晋升规则；研究规划、取证、报告与 Runtime 合同分别跟随其 owner。

| 区域 | 内容 |
|---|---|
| `policies/` | 规则权威、参数权威、判断阈值、方法路由 |
| `contracts/` | 跨阶段公共语义与包类型 |
| `knowledge_promotion/` | Candidate → Evaluation → Release → Usage 的规则 |

规则是否被满足由 [`../04_verifiers/`](../04_verifiers/README.md) 判定；规则带来的研究价值由 [`../05_evals/`](../05_evals/README.md) 评估。
