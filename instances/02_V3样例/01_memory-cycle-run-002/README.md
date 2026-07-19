# memory-cycle-run-002

Ontology 3.0 / Public Contract 1.3 的存储芯片周期示范样例。

## 示范要点

1. **三个判断单元**：库存状态（J3）、周期阶段（J2）、需求归因（indeterminate）
2. **方法全链**：候选 → 选择/拒绝/阻断/降级 → 执行，含 kb04:A09 拒绝、kb03:A04 阻断
3. **证据四类**：支持 / 反证 / 冲突（CF-01：合约 vs 现货）/ 缺口（EG-01：OEM 序列缺失）
4. **竞争解释**：供给收缩（CE-01 未排除）、价格口径冲突（CE-02 unresolved）
5. **信号链**：EvidenceFact → Signal → Hypothesis → RuleEvaluation → MethodApplication → Judgment
6. **05 反查**：EX-01/02/03 均可反查至 C-* → MA-* → EV-*
7. **增量更新**：EV-04 仅使 JU-02 链 stale；EA-02 评估失效进入闭包；C-01/C-03 保持 current

阅读顺序：`01_task.yaml` → `02_structure.yaml` → `03_evidence.yaml` → `04_judgment.yaml` → `05_expression.yaml` → `05_report.md` → `incremental_update.yaml`。
