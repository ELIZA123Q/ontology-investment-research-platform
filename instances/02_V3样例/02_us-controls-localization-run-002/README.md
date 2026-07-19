# us-controls-localization-run-002

Ontology 3.0 / Public Contract 1.3 的美国管制与国产设备替代示范样例。

## 示范要点

1. **政策事件 + 半导体领域对象**：Event、WaferFab、ProcessNode、SemiconductorEquipment、YieldMetric
2. **领域关系**：`facilityUsesEquipment`（qualification 阶段）、`facilityLocatedIn`、`eventAffectsState` 与 `stateVariableForObject`
3. **方法链**：kb03:A05 降级、kb04:A10 阻断（缺定价输入）
4. **证据结构**：支持 / 反证 / 缺口（EG-11：批量采购序列 partially_met）
5. **竞争解释**：原有采购周期（CE-11 unresolved）、验证≠收入（CE-12 retained）
6. **05 反查**：EX-11/12 → C-11/12 → MA-14/15 → EV-11/12/13
7. **增量更新**：EV-14 验证失败仅 stale JU-02 链；EA-12 评估失效；C-11 管制判断保持 current

阅读顺序：`01_task.yaml` → `02_structure.yaml` → `03_evidence.yaml` → `04_judgment.yaml` → `05_expression.yaml` → `05_report.md` → `incremental_update.yaml`。
