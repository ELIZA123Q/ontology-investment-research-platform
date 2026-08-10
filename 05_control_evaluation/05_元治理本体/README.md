# 本体演进治理（元治理）

> **面向开发者，研究员可跳过。**
> 这里管理「投研知识体系本身如何被修改」：谁提出变更、影响谁、如何检查与批准、何时成为新基线。日常做行业研究通常不需要打开本目录。

## 给谁看

仅维护者 / 本体治理相关开发者。

## 材料从哪来

| 入口 | 用途 |
|---|---|
| [`00_本体演进治理框架概述.md`](00_本体演进治理框架概述.md)（若在嵌套树）/ 概述与模型文件 | 设计原则与闭环 |
| [`meta_schema.yaml`](meta_schema.yaml) | 治理本体元模式 |
| [`model_registry.yaml`](model_registry.yaml) | 治理模型唯一注册表 |
| [`models/`](models) | 对象、关系、Action、规则等 |
| [`元治理本体/`](元治理本体/README.md) | 历史嵌套布局；**勿双写**，权威以本目录根文件为准 |

组织方式类似正式本体，但**不属于**投研业务本体。正式业务本体在 [`01_semantic_knowledge/01_ontology/`](../../01_semantic_knowledge/01_ontology/README.md)。

**路径别名：** `05_control_evaluation/knowledge_changes` 是指向本目录的符号链接（同一棵树），不是第二套权威。

## 怎么用

1. 需要改某个研究概念的定义或关系时，按概述走 Branch → Proposal → 检查 → 审批 → Release。
2. 治理对象只能通过稳定 ID / 指纹引用业务面，不把治理 Action 注册进正式本体 registry。
3. 研究员继续用方法库与工作台；不要把元治理当成业务分析方法。

## 怎么维护

- 正文与模型只维护一份（本目录）；不要在嵌套 `元治理本体/` 平行扩写。
- 改完运行：

```bash
python3 05_control_evaluation/03_校验/validate_governance_control_plane.py
```

- 旧合同 `02_合同/governance_control_contract.yaml` 等可为兼容投影，不是状态机事实源。

---

## 维护者附录（可跳过）

借鉴思路：对象/关系表达影响网；Action Type 为唯一写入口；Branch/Proposal/Diff/Check/Approval/Rebase/Release 闭环；Action Log 与 Release Baseline 可追溯。
