# 场景任务域 — 研究问题怎么拆成任务

> 第一次接触项目？先读仓库根目录 [`README.md`](../README.md)。

这里定义「用户的研究问题怎么展开成可组合、可分支、可回溯的研究问题图」。好比研究员拿到一个课题后，先拆成子问题、确定研究场景、选择任务类型——这个目录就是定义这些拆法的地方。

**不管**「靠什么能力来完成」（那是 `03_agent_capability/`），也**不管**「这次具体怎么执行」（那是 `06_runtime/`）。

## 里面有什么

| 子目录 | 一句话说明 | 你需要管吗 |
|--------|-----------|-----------|
| [`00_problem_graph/`](00_problem_graph/README.md) | **问题图装配规则**：意图、场景、任务怎么组合成一张图 | 改图的组装规则时看 |
| [`01_intents/`](01_intents/README.md) | **用户意图**：用户可能提出哪类研究目标 | 加新意图类型时改 |
| [`02_scenarios/`](02_scenarios/README.md) | **场景类型 + 场景卡**：比如「公司研究」「行业研究」各有什么约束 | 加新研究场景时改 |
| [`03_tasks/`](03_tasks/README.md) | **任务模板**：每个任务要完成什么判断、什么时候算完成 | 加新任务类型时改 |
| [`04_roles/`](04_roles/README.md) | **责任角色**：研究任务中有哪些责任位置（不是具体的人） | 加新角色时改 |
| [`05_workflow_patterns/`](05_workflow_patterns/README.md) | **工作模式**：给规划器的优先级建议（深研/快研/仅取证） | 改规划策略时看 |

## 日常怎么用

1. 用户提出研究目标 → 匹配 `01_intents/` 中的意图类型
2. 确定研究场景 → 在 `02_scenarios/` 找对应场景卡
3. 拆成子任务 → 从 `03_tasks/` 选合适的任务模板
4. 系统把以上组合成「研究问题图」，把未解决的部分交给 `06_runtime/` 执行

## 怎么维护

- **加新场景卡**：写在 `02_scenarios/` 对应行业目录下，研究框架资源留在 `03_agent_capability/02_skills/research_design/`
- **加新任务**：必须声明 `graph_motif`（图模式），但**不能**在图模式中绑定具体 Skill、Tool 或 Runtime Node
- **改可执行节点**：去 `06_runtime/` 改 node-catalog / planner

### 三条禁止

1. **禁止恢复固定 01→05 流水线** — 目录编号是职责分区，不是固定步骤
2. **禁止把 Intent → Scenario → Task 当成必须单选、单向、一次性的链条** — 一次请求可以激活多个任务，可以共享证据，可以只重算受影响部分
3. **禁止在新任务里绑定具体 Skill 或 Tool** — 任务只说「要完成什么判断」，不说「用哪个工具」

## 常见问题

**Q：这里的 Intent 和 Runtime 里的 ResearchIntent 有什么区别？**
A：这里的 Intent 是用户级意图（用户想做什么类型的研究），Runtime 里的 ResearchIntent 是执行级实例（这次具体研究什么）。前者是定义，后者是实例。

**Q：什么是 frontier？**
A：研究问题图中「还没解决的部分」。系统只把当前 frontier 编译成可执行任务，做完后结果回写，按失效传播增量重规划。

**Q：什么是 graph_motif？**
A：任务在图中的连接模式——这个任务和哪些其他任务共享节点、依赖什么前置结果。好比任务之间的「接线图」。

---

## 技术附录（给开发维护者）

### 问题图架构

```text
User Request
  ├─ Intent ───────────────┐
  ├─ Scenario constraints ─┼─→ Research Problem Graph（02）
  └─ Task motifs ──────────┘        │ unresolved frontier
                                    ▼
                         Runtime Execution TaskGraph（06）
```

箭头表示关系，不表示固定流水线。一次请求可激活多个 Task motif；可共享判断单元与证据，也可在新事实到来后只重算受影响子图。

### 三张图不能混写

- **Research Problem Graph**：本目录装配（Intent + Scenario + Task → 问题图）
- **Research Provenance Graph**：`01_semantic_knowledge/03_knowledge_graph/` 的图合同（结论为什么成立）
- **Execution TaskGraph**：`06_runtime/` 的 Runtime（这次怎么跑）

### 跨域引用

- 真正「这次怎么跑」由 [`06_runtime/`](../06_runtime/README.md) 动态规划
- 怎么思考见 [`03_agent_capability/02_skills/`](../03_agent_capability/02_skills/README.md)
