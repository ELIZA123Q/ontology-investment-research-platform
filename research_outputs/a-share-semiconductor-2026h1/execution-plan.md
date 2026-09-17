# 动态执行计划

计划 ID：`plan:request:a-share-semiconductor-2026h1:r1`  
Logic：`complete_research@1.0.0`  
选路规则：`route_complete_research@1.0.0`  
内容哈希：`35a62fcafc3c1cd843b633e2e7159f03c524c9c698cb731dea94748b39e081fb`

初始图状态为 `evidence_ready=false`、`conflict_detected=false`。规划器因此选择完整研究 Logic，同时按规则删除未触发的 `conflict_followup` 节点，编译出 13 节点 DAG；这不是固定阶段链。

## DAG 与选择理由

| 拓扑位置 | 节点 | Capability | 生命周期视图 | 选择/完成理由 |
|---:|---|---|---|---|
| 1 | normalize | normalize_request | request | 全量研究需要规范化任务输入 |
| 2 | context | resolve_semantic_context | design | 建立行业、对象和指标的语义引用 |
| 3 | acquire | acquire_evidence | evidence | `evidence_refresh_required=true` |
| 4 | extract | extract_claims | evidence | 来源已取得，抽取带定位主张 |
| 5 | facts | synthesize_facts | evidence | `formal_fact_gate` 通过后形成正式事实 |
| 6a | conflicts | detect_conflicts | evidence | 检查范围冲突和事实冲突 |
| 6b | hypotheses | form_hypotheses | reasoning | 事实与语义上下文已齐备，可并行形成假设 |
| 7 | assess | evaluate_evidence | evidence | 事实与冲突检查完成，给出证据等级和判断上限 |
| 8 | reason | evaluate_reasoning | reasoning | 假设与证据评价齐备，执行机制/反证/范围裁决 |
| 9 | judgment | form_judgment | reasoning | `formal_judgment_gate` 通过，且未触发 J1 上限 |
| 10 | draft | render_report | publication | 正式 J2 判断存在，可生成研究草稿 |
| 11 | approval_request | request_publication_approval | publication | 草稿需要独立人工审批 |
| 12 | publish | publish_report | publication | 首次执行因缺少 `ApprovalRecord` 暂停；用户批准后恢复并完成 |

实际图中 `conflict_followup` 未被编译，因为初始状态没有事实冲突；如将 `conflict_detected` 设为 `true`，该补证能力会被规则加入计划。

## 权限与门槛

- `EvidenceFact` 只有在至少一个正式来源、至少一个带原文定位的主张存在时才能写入。
- `Judgment` 只有在证据链完整、证据评价完成、至少一个研究规则评价存在时才能写入。
- 证据质量上限规则没有触发 J1 降级；人工设定的样本范围限制使最终判断保持 J2。
- `PublishedReport` 是非幂等、有副作用能力；首次运行没有人工审批时未执行，写入 `approval:31ad7cd6-ee7c-4e7d-98fd-556d02fb95e6` 后恢复并成功发布。

当前计划状态：`completed`；13 个节点全部完成，等待项与失败节点均为零。
