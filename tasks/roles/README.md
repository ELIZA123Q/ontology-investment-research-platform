# tasks/roles

- **回答什么：** 角色/专家卡（职责、可调用 skill、人工门）。
- **不放什么：** 模型 provider 配置、单次审批记录、本体类型定义。
- **当前权威资产：** `runtime/agents/{01_intake…05_delivery,reviewer}/` 中的角色合同（抽取到 `registry.yaml`）。
- **status:** migrating

角色卡用于 Task 层治理，不替代 capabilities/agents 的执行合同。
