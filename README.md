# 投研判断工作台

一个帮研究员做投研判断的 AI 工作台。当前生产产品聚焦 **A 股半导体公司业绩更新与投资命题复核**：从正式披露出发，核验实际值、比较边界和命题影响，生成可追溯、可改判的报告。

## 这里是干什么的

这个项目是一个**投研推理平台**。简单说：

- 你在网页上输入公司、研究截止日和本次业绩复核问题
- 系统的 AI 助手（叫 Research Lead）按 `earnings_update` 合同生成不超过 15 个初始节点的研究计划
- 你确认计划后，系统后台自动执行：找证据、核验来源、形成判断
- 证据和判断需要你确认后才会成为正式结论
- 最终生成一份可以追溯到每条证据来源的研究报告

**核心理念**：系统负责跑腿和整理，研究员负责判断和拍板。AI 不能编造数据，证据不足时系统会明确说「暂不可判断」，而不是硬凑结论。

## 里面有什么

项目按编号分成六个目录，编号代表职责分工，**不是**固定的研究流水线：

| 目录 | 一句话说明 | 你需要管吗 |
|------|-----------|-----------|
| [`01_semantic_knowledge/`](01_semantic_knowledge/README.md) | **系统认识什么**：概念定义、术语词典、知识关系图 | 改概念和术语时看 |
| [`02_scenario_task/`](02_scenario_task/README.md) | **要研究什么**：研究问题怎么拆、有哪些场景和任务类型 | 加新研究场景时看 |
| [`03_agent_capability/`](03_agent_capability/README.md) | **靠什么做**：AI 助手是谁、会什么技能、能用什么工具 | 改 AI 能力时看 |
| [`04_context_state/`](04_context_state/README.md) | **做到哪了**：任务进度、记忆、工作环境的规则定义 | 一般不用管 |
| [`05_control_evaluation/`](05_control_evaluation/README.md) | **什么算合格**：规则、权限、质量检查、效果评估 | 改质量标准时看 |
| [`06_runtime/`](06_runtime/README.md) | **真正跑起来的程序**：网页、接口、数据库、AI 执行引擎 | 启动和日常维护看这里 |

> 另有 [`DOMAIN_AUTHORITY.md`](DOMAIN_AUTHORITY.md) 定义「东西该放哪个目录」的规则——改东西前先看一眼。

## 日常怎么用

### 启动系统

**方式一（推荐，最简单）**：双击项目根目录的 `start-light.command` 文件。它会自动检查环境、安装依赖、启动系统并打开浏览器。

**方式二（开发模式）**：在终端里执行：
```bash
cd 06_runtime
npm install    # 首次使用需要安装依赖
npm run dev    # 启动开发模式
```
然后另开一个终端执行 `npm run worker`（启动后台处理进程），最后用浏览器打开 `http://127.0.0.1:3000`。

### 做一次研究

1. 在网页首页创建一个公司业绩复核案例
2. 输入公司、研究截止日和命题复核问题
3. AI 助手给出研究计划，你确认后系统开始执行
4. 右侧实时展示证据、判断、报告等产出
5. 关键证据和判断需要你确认
6. 报告通过审计后，你确认发布才会正式输出

完整首次覆盖、预测模型和估值仍处于 evaluation/candidate 范围；在达到正式案例、盲评和发布证据门槛前，不作为生产能力承诺。

### 改了东西之后

如果你修改了 01-05 目录里的定义文件（比如改了概念、加了场景、改了规则），需要让系统知道这些变化：

```bash
cd 06_runtime
npm run domain:sync     # 把 01-05 的定义同步到可执行程序里
npm run knowledge:bundle # 生成按内容寻址、可回放的不可变知识包
npm run audit:domain    # 检查跨目录引用是否一致
npm run audit:architecture # 检查模块依赖方向与纯领域边界
npm run build           # 重新构建
```

## 怎么维护

| 要改什么 | 改哪个目录 | 改完做什么 |
|---------|-----------|-----------|
| 概念定义、术语词典 | `01_semantic_knowledge/` | 跑 `domain:sync` + `validate_project.py` |
| 研究场景、任务类型 | `02_scenario_task/` | 跑 `domain:sync` + `audit:domain` |
| AI 技能、工具能力 | `03_agent_capability/` | 跑 `domain:sync` + `audit:domain` |
| 质量标准、检查规则 | `05_control_evaluation/` | 跑 `validate_project.py` |
| 网页界面、程序逻辑 | `06_runtime/` | 跑 `npm test` + `npm run build` |

**最重要的一条规则**：01-05 是「定义权威」（说什么算什么），06 是「执行实现」（真正干活）。不要在 06 里另写一套业务定义，也不要在 01-05 里写可执行代码。详见 [`DOMAIN_AUTHORITY.md`](DOMAIN_AUTHORITY.md)。

## 常见问题

**Q：系统说「暂不可判断」是什么意思？**
A：说明证据不够。系统不会硬凑结论，需要你补充更多证据来源。至少需要两个不同发布主体的证据才能形成判断。

**Q：AI 会不会编造数据？**
A：不会。系统设计了多重防护：AI 只能提出假设和候选判断，不能编造数值、越权引用或给出评级。财务计算由确定性程序完成，不由 AI 生成。

**Q：报告改了之后要重新审计吗？**
A：是的。每次保存报告会生成新版本，修改后需要重新审计。判断修改后也需要重新确认。

**Q：AKShare 数据源是什么？**
A：一个免费的 A 股公开数据接口，用于获取新闻和公告。它不是必须的——没有它系统也能启动，只是「关注变化」功能会显示降级。

---

## 技术附录（给开发维护者）

### 产品原则

- **专业优先**：本体、来源策略、方法资产、权限和质量门槛是硬边界。
- **Agent 负责路径**：Research Lead 在白名单节点、预算和停止条件内组合 Skill 与 Tool。
- **不是纯聊天**：计划、证据、判断和发布都以结构化制品呈现，关键节点需要研究员确认。
- **报告不是终点**：正式结论必须能回溯到 EvidenceFact、SourceSnapshot、MethodApplication 和审批记录。

### 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 16 | Web 框架（App Router，webpack 模式） |
| React | 19 | UI 库 |
| TypeScript | 5.9 | 类型系统（strict 模式） |
| Node.js | 24 | 运行环境（内置 `node:sqlite`） |
| Zod | 4.x | Schema 验证 |
| Vitest | 4.x | 测试框架 |

> Turbopack 因中文路径崩溃，使用 webpack 构建。

### 启动详情

首次使用先在 `06_runtime/` 执行 `npm install`。开发模式：

```bash
cd 06_runtime
npm run dev          # 启动 Web 服务
npm run worker       # 另开终端，启动后台 Worker
```

访问 `http://127.0.0.1:3000`。可用 `VNEXT_DB_PATH` 覆盖数据库路径。

macOS 双击 `start-light.command`：检查 Node.js 24、依赖与端口，构建后启动应用、worker 和可选 AKShare 连接器，健康检查通过后自动打开浏览器。如 3000 被占用，会选择 3001–3010 中的空闲端口。

### 运行模式

- `local`（默认）：仅 loopback，适合单用户本机工作台；`npm run start`。
- `server`：`npm run start:server`，需提供 `VNEXT_SERVER_IDENTITIES_JSON`、`VNEXT_ALLOWED_ORIGINS` 和 `VNEXT_SERVER_CSRF_TOKEN`。

### 关键命令

| 命令 | 用途 |
|------|------|
| `npm run domain:sync` | 从 01-05 同步生成投影到 `06_runtime/src/generated/` |
| `npm run audit:domain` | 检查跨域引用一致性 |
| `npm run audit:cutover` | 检查 Capability 发布切换 |
| `npm test` | 运行测试 |
| `npm run typecheck` | 类型检查 |
| `npm run build` | 构建 |
| `npm run db:check` | SQLite 完整性检查 |
| `npm run db:backup -- /path/backup.sqlite` | 数据库备份 |
| `npm run db:restore -- /path/backup.sqlite [/path/restored.sqlite]` | 生成校验后的恢复副本，不覆盖当前数据库 |

发布前或夜间运行 `cd 06_runtime && npm run security:audit`，检查生产依赖的高危及以上安全公告；项目的离线验收不会将网络不可用误判为代码失败。
| `npm run eval:live:canary` | 工程 canary 评测（3 个案例，DeepSeek） |
| `npm run eval:public:evidence:pilot` | 一个公开冻结案例的三轨同证据诊断（系统/直答/摘要；不计入正式评测） |
| `npm run eval:earnings:replay` | 业绩快报确定性回放 |
| `python3 05_control_evaluation/04_verifiers/validate_project.py` | 全库一致性校验 |

### 修改流程（DOMAIN_AUTHORITY）

1. 先修改上表对应的 01–05 权威文件。
2. 执行 `npm --prefix 06_runtime run domain:sync`，更新只读投影 `06_runtime/src/generated/domain-catalog.ts`。
3. 如涉及 Ontology 或财务规则，同步执行对应的 `ontology:sync` / 规则生成器。
4. 执行 `python3 05_control_evaluation/04_verifiers/validate_project.py`。

`src/generated/` 中的文件可入 Git，但不得手工编辑。`domain:check` 会用源文件指纹阻止漂移；`audit:domain` 还会检查 Task/Scenario/Workflow/Capability/失效边的跨域引用和 Runtime 重复定义。

### 当前成熟度

已具备本地持久化、受约束规划、证据溯源、结构化审批、报告审计、知识沉淀控制面和可信前端。华泰智研 MCP 半导体行业景气度已完成真实调用、受授权 Runtime 映射和原始响应私密冻结。DataYes 财务表因积分不足未取得样本。正式研究价值评测须满足独立密封裁决、扰动集、模型隔离和同证据基线。

### 架构文档

- 运行时边界与请求生命周期：[`06_runtime/ARCHITECTURE.md`](06_runtime/ARCHITECTURE.md)
- 产品路由和可信交互约束：[`06_runtime/app-surface.yaml`](06_runtime/app-surface.yaml)
- 能力发布状态：[`03_agent_capability/releases/current.json`](03_agent_capability/releases/current.json)
