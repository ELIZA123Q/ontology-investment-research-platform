# tasks/workflows/deep_research

- **回答什么：** 深度研究推荐路径（原 01—05 阶段合同：输入、产出、门槛、返工）。
- **不放什么：** 系统总骨架、方法正文、本体定义、单次产物。
- **status:** `migrating`
- **registry:** [`registry.yaml`](./registry.yaml)
- **write_entry:** 本目录（新增/修改阶段规范写这里）
- **read_primary:** 本目录（`runtime_contexts` / coverage 默认注入）
- **compat_read:** `runtime/workflow/stage_specs/`（回放保留，不再作为新增入口）

说明：Workflow 只是 Task 的推荐执行路径，不是整个项目的核心。
