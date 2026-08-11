# 投研判断工作台

面向专业研究员的 AI 原生投研工作台。目标架构把研究目标展开成可分支、可合流、可失效传播的 Research Problem Graph，再把当前未解决 frontier 编译成受约束的 Execution TaskGraph；运行结果沉淀为可核验的证据、竞争解释、正式判断和可编辑交付物。证据不足时明确降级为「暂不可判断」，不会用流畅表达掩盖证据缺口。当前 Runtime 已执行 TaskGraph，Problem Graph 的完整运行时物化仍按 `02_scenario_task` 合同逐步接入。

## 产品原则

- **专业优先**：本体、来源策略、方法资产、权限和质量门槛是硬边界。
- **Agent 负责路径**：Research Lead 在白名单节点、预算和停止条件内组合 Skill 与 Tool。
- **不是纯聊天**：计划、证据、判断和发布都以结构化制品呈现，关键节点需要研究员确认。
- **报告不是终点**：正式结论必须能回溯到 EvidenceFact、SourceSnapshot、MethodApplication 和审批记录。

## 启动

首次使用先在 `06_runtime/` 执行 `npm install`。开发模式：

```bash
cd 06_runtime
npm run dev
```

另开一个终端运行 `npm run worker`，然后访问 `http://127.0.0.1:3000`。macOS 也可双击 [`start-light.command`](start-light.command)：它会检查 Node.js 24、依赖与端口，构建后启动应用、worker 和可选 AKShare 连接器，健康检查通过后自动打开浏览器。如 3000 被其他程序占用，会选择 3001–3010 中的空闲端口，不会强制终止其他进程。

AKShare 首版只用于手动刷新 A 股研究主题相关的公开新闻和公告，不提供自动定时或实时行情。连接器不可用时主工作台仍可启动，状态会显示为降级。候选新闻与公告必须经过来源快照、证据确认和判断门槛，不会自动成为正式事实。

## 仓库地图

目录编号表示职责分区，**不是**固定研究流水线。唯一可执行应用在 `06_runtime/`。

| 目录 | 人话 |
|---|---|
| [`01_semantic_knowledge/`](01_semantic_knowledge/README.md) | 世界里有什么：概念、词典、证据语义 |
| [`02_scenario_task/`](02_scenario_task/README.md) | 现在要解决什么：研究问题图、意图、场景、任务 motif、角色 |
| [`03_agent_capability/`](03_agent_capability/README.md) | 靠什么完成：Agent / Skill / Tool / Protocol |
| [`04_context_state/`](04_context_state/README.md) | 现在看见什么、做到哪里、记住什么、正在操作什么 |
| [`05_control_evaluation/`](05_control_evaluation/README.md) | 什么能做、什么算合格 |
| [`06_runtime/`](06_runtime/README.md) | 应用、API、worker 与用户工作台；加载、组合并执行以上能力 |

运行时边界与请求生命周期见 [`06_runtime/ARCHITECTURE.md`](06_runtime/ARCHITECTURE.md)，产品路由和可信交互约束见 [`06_runtime/app-surface.yaml`](06_runtime/app-surface.yaml)。

## 当前成熟度

已具备本地持久化、受约束规划、证据溯源、结构化审批、报告审计、知识沉淀控制面和可信前端。现有华泰智研 MCP 的半导体行业景气度已完成真实调用、受授权 Runtime 映射和原始响应私密冻结；研报、事件、前端与模型只接收指纹和许可边界。DataYes 财务表当前因积分不足未取得样本，其他实时网页/PDF/金融数据仍需继续映射。正式研究价值评测必须满足独立密封裁决、扰动集、模型隔离和同证据基线，不以运行时自检冒充研究质量分数。
