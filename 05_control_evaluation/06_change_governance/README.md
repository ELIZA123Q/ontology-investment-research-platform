# Change Governance

这里回答「规则和本体本身如何被修改」。它管理 Branch → Proposal → Check → Approval → Release 的变更闭环；它是 Control Plane 对 Ontology Change 的治理，不是第四套投研业务本体。

| 区域 | 内容 |
|---|---|
| `ontology/overview.md` | 演进原则与闭环 |
| `ontology/meta_schema.yaml` | 治理元模式 |
| `ontology/model_registry.yaml` | 治理模型唯一注册表 |
| `ontology/models/` | Asset、Change、Action、Policy 等模型 |
| `ontology/instances/` | 受治理资产与关系实例 |
| `ontology/compat/` | 只读兼容投影，不是权威状态机 |

正式业务本体仍在 [`01_semantic_knowledge/01_ontology/`](../../01_semantic_knowledge/01_ontology/README.md)。迁移历史在 [`docs/migrations/repository_history/ontology_evolution/`](../../docs/migrations/repository_history/ontology_evolution/)。

变更后运行：

```bash
python3 05_control_evaluation/04_verifiers/validate_governance_control_plane.py
```
