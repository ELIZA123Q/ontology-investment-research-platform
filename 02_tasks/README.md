# Task — 场景任务域

Agent「要完成什么」：场景、标准 Task、角色、推荐 Workflow。

原 01—05 降级为 `workflows/deep_research/`，不再充当仓库骨架。

| 项 | 值 |
|----|----|
| **status** | `active`（注册表可独立回答权威；Deep Research 镜像已为默认读） |
| **registry** | [`registry.yaml`](./registry.yaml) |
| **权威怎么查** | [`five_domain_authority.yaml`](../05_governance/01_架构/five_domain_authority.yaml) → 本域 registry → 子域 registry |
| **write_entry** | `02_tasks/`（阶段规范新增改动写 `workflows/deep_research/`） |
| **compat_read** | `07_runtime/workflow/stage_specs/` |
| **上位** | [`00_五域系统骨架.md`](../05_governance/01_架构/00_五域系统骨架.md) |
