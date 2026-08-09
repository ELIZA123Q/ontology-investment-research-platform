# Task — 场景任务域

Agent「要完成什么」：场景、标准 Task、角色、推荐 Workflow。

原 01—05 降级为 `workflows/deep_research/`，不再充当仓库骨架。

| 项 | 值 |
|----|----|
| **status** | `active`（Intent/Task/typed TaskGraph 为运行主链） |
| **registry** | [`registry.yaml`](./registry.yaml) |
| **权威怎么查** | [`five_domain_authority.yaml`](../05_governance/01_架构/five_domain_authority.yaml) → 本域 registry → 子域 registry |
| **write_entry** | `02_tasks/`；Deep Research 仅维护为可选模板 |
| **执行权威** | `07_runtime/src/runtime/node-catalog.ts` 与 `planner.ts` |
| **上位** | [`00_五域系统骨架.md`](../05_governance/01_架构/00_五域系统骨架.md) |
