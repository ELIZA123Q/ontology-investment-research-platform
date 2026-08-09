# 投研判断工作台

本地优先、可云化、面向单研究员的 AI 原生研究搭档。研究员只表达目标、补充材料、审阅关键判断和调整方向，不需要理解五域、五阶段、Agent 或本体结构。

> **确定性负责边界，Agent 负责路径。**

## 产品入口

```bash
bash start-light.sh
```

访问 `http://127.0.0.1:3000`。启动脚本同时运行 Next.js 工作台与独立 Runtime worker。

开发模式：

```bash
cd 07_runtime
npm install
npm run dev
```

另开终端运行 `npm run worker`。

## 用户如何工作

主界面只有三部分：

- 左侧：研究主题与长期会话。
- 中间：研究员与 Research Lead 的连续对话、计划和执行状态。
- 右侧：证据矩阵、假设、判断卡、报告与审计时间线等动态可信制品。

用户可以直接说“只补一手来源”“把时间改成未来六个月”“从历史判断创建分支”。Runtime 不强制重新执行完整 01—05。

## 当前架构

```text
Intent → Task → constrained TaskGraph → Skill / Tool / Policy / Verifier
       → Event + key Checkpoint → Artifact → trusted UI surface
```

- vNext.1 只有一个活动 Agent：Research Lead。
- 5 个 Skill：research-framing、research-method、evidence-assessment、hypothesis-analysis、research-writing。
- Context Builder 是 Runtime Service；Source Capture 是 Tool；引用审计是 Verifier；重规划是 Lead Policy。
- Message 与 Trace 从 append-only Event 投影；ContextPackage 是临时对象。
- 没有合格 Evidence 时，Claim 不能标记 supported，Judgment 必须降级为“暂不可判断”。
- 自有 agent loop 通过 adapter 接入 OpenAI-compatible/DeepSeek、OpenAI 和 Anthropic。

## 仓库职责

| 目录 | 权威职责 |
|---|---|
| `01_semantic/` | 本体、语义词典、Domain Semantic Graph、证据语义 |
| `02_tasks/` | Intent、Task 定义、场景与可选 Deep Research 模板 |
| `03_capabilities/` | Agent/Skill/Tool 治理索引、方法库和 MCP 配置 |
| `04_execution/` | Context/Memory 合同、历史 Workspace 与 Runtime 索引 |
| `05_governance/` | 架构、规则、权限、Verifier、Eval 和迁移路线 |
| `06_app/` | 产品路由与可信组件登记 |
| `07_runtime/` | 唯一可执行 App、Agent Kernel、Store、Worker 和测试 |

权威入口：[five_domain_authority.yaml](05_governance/01_架构/five_domain_authority.yaml)。五域只作为后台职责边界，不建设成五个 UI 中心。

## 研究资产

- 半导体场景与历史样例继续保留在 `01_semantic`、`02_tasks`、`03_capabilities/05_method_libraries` 和 `04_execution/03_workspace`。
- 原 01—05 内容保留为方法模板、历史回放和配对评测基线，不是 Runtime 状态机。
- Domain Semantic Graph 与 Research Provenance Graph 分开治理，通过混合检索接口关联。

## 验证

```bash
cd 07_runtime
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

下一轮优化路线见：[2026-08-09_vNext2真实研究闭环.md](05_governance/04_路线图/2026-08-09_vNext2真实研究闭环.md)。
