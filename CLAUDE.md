# 投研判断工作台 — AI 开发上下文

## 不可破坏的原则

1. 确定性负责边界，Agent 负责路径。
2. 禁止恢复固定 01→05 controller；Deep Research 只是可选模板。
3. Agent/Skill/Tool 唯一可执行 manifest：`06_runtime/src/capabilities/registry.ts`。
4. Skill 只保存程序性知识；Context Builder、Provider、Tool、Policy、Verifier 不伪装成 Skill。
5. vNext.1 只调度 `research-lead`；planned Agent 不得被运行。
6. 未经 Source Capture 不得形成 EvidenceFact；无合格 Evidence 时 Judgment 必须降级。
7. Event 记录动作，Checkpoint 只写关键恢复状态；不做纯 Event Sourcing。
8. ContextPackage 临时装配；Message、Trace 从 Event 投影。
9. Domain Semantic Graph 与 Research Provenance Graph 不合并成万能图。
10. Agent 只能组合可信组件，不能生成任意 HTML/JavaScript。

## 权威文件

| 内容 | 文件 |
|---|---|
| 五域职责 | `05_control_evaluation/01_架构/five_domain_authority.yaml` |
| 运行对象 | `06_runtime/src/contracts.ts` |
| typed node catalog | `06_runtime/src/runtime/node-catalog.ts` |
| 动态 planner | `06_runtime/src/runtime/planner.ts` |
| Agent loop | `06_runtime/src/runtime/kernel.ts` |
| SQLite/Event/Checkpoint | `06_runtime/src/runtime/store.ts` |
| Agent/Skill/Tool | `06_runtime/src/capabilities/registry.ts` |
| Verifier | `06_runtime/src/governance/verifiers.ts` |
| 图边界 | `06_runtime/src/semantic/graph-contracts.ts` |
| MCP 资产 | `03_agent_capability/04_protocols/mcp/registry.yaml` |
| 方法资源 | `03_agent_capability/05_method_libraries/` |

## 产品与启动

- 唯一地址：`http://127.0.0.1:3000`
- App/API：`06_runtime/app/`
- 开发服务：`cd 06_runtime && npm run dev`
- 独立 worker：`cd 06_runtime && npm run worker`
- 生产启动：根目录执行 `bash start-light.sh`

## 数据与来源

MCP、API、数据库终端和 AI 工具是获取通道，不是来源生产者。每次获取必须记录 connector、上游来源、参数、快照/原始响应、locator、哈希、权限范围和获取时间。金融 MCP 配置见 `03_agent_capability/04_protocols/mcp/`。

## 修改后验证

在 `06_runtime/` 运行：`npm test`、`npm run typecheck`、`npm run build`。Capability 或路径调整后还必须运行 `node --import tsx scripts/audit-cutover.ts`。
