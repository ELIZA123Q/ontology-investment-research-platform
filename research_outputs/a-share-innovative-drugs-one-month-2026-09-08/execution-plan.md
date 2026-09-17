# 动态执行计划与实际结果

## 规则选择

- 任务模式：`full_research`
- 命中路由规则：`route_complete_research@1.0.0`
- 调用Logic：`complete_research@1.0.0`
- 金融数据源：`akshare_mcp`，固定revision `9b6a22b6d83cce2a996a5072743bb06686040ce0`
- 计划：`plan:request:a-share-innovative-drugs-one-month-2026-09-08:r1`

计划由任务状态动态编译，共13个节点。它不是固定的五阶段顺序；依赖允许的节点可并行，发布节点由人工审批规则单独激活。

## DAG

```text
normalize → context → acquire → extract → facts → conflicts ─┐
                    context ───────────→ hypotheses ───────────┼→ reason → judgment → draft → approval_request → publish
                                      facts ─→ assess ─────────┘
```

`acquire`节点由 `evidence_refresh_required` 激活，并显式携带 `data_source_ref=akshare_mcp`。`judgment`节点同时依赖假设、证据评价和规则评价。`publish`是非幂等、有副作用节点，只有 `publication_requires_human_approval` 命中且图中存在人工 `ApprovalRecord` 时才可运行。

## 实际执行

- 已完成：normalize、context、acquire、extract、facts、conflicts、hypotheses、assess、reason、judgment、draft、approval_request。
- 等待：`ApprovalRecord`。
- 未执行：publish。
- 失败节点：无。
- 证据质量规则：`evidence_quality_cap@1.0.0`命中，判断上限锁定为J1。
- 正式事实门：通过。
- 正式判断门：通过，但仅允许J1。
- 发布门：未通过，原因是缺少人工审批记录。

## 每个节点为何完成或停止

- 任务、上下文、取证、抽取、事实与冲突节点：所需上游类型已存在，规则允许执行并产生声明类型。
- 假设和证据评价：各自依赖的事实/上下文/冲突记录齐备。
- 推理与判断：证据谱系完整，J1没有超过规则上限。
- 草稿与审批请求：正式判断存在，因此生成草稿和审批请求。
- 发布：缺少 `ApprovalRecord`，按规则等待而非失败，也未创建 `PublishedReport`。

