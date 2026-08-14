# 东西该放哪个目录 — 写入权威规则

> 第一次接触项目？先读仓库根目录 [`README.md`](README.md)。

这个项目有六个目录，每个目录只管自己那块事。**核心规则：01-05 是声明控制面（说什么算什么），06 是执行与实例数据面（真正干活）。** 新的业务知识、定义、参数只能写在 01-05 对应的目录里，不能写在 06 里。

每项资产必须区分四个位置：**声明权威**、**生成投影**、**执行绑定**和**实例数据**。完整机器矩阵见 `05_control_evaluation/01_rules/policies/asset_authority_matrix.yaml`。生成文件可以进入 06，但必须带来源指纹且不得手工编辑。

## 一张表看懂「该改哪里」

| 你想改的东西 | 唯一该改的目录 | 06 能做什么 |
|-------------|--------------|------------|
| 概念定义、术语词典、知识关系 | `01_semantic_knowledge/` | 读取并生成查询用的索引，不能自己另定义 |
| 研究意图、场景类型、任务模板、角色 | `02_scenario_task/` | 把研究问题编译成可执行的任务图 |
| AI 助手、技能、工具、协议 | `03_agent_capability/` | 绑定具体程序，执行前检查是否已发布 |
| 上下文规则、状态定义、记忆规则 | `04_context_state/` | 装配上下文、保存状态、管理工作区 |
| 规则、阈值、权限、校验器、评估标准 | `05_control_evaluation/` | 执行检查、计算结果、记录校验记录 |
| 网页、接口、数据库、程序逻辑 | `06_runtime/` | 唯一能跑的程序，但不是业务知识权威 |

## 改完之后做什么

```
第 1 步：改 01-05 对应目录里的定义文件
         ↓
第 2 步：cd 06_runtime && npm run domain:sync
        （把定义同步到程序能读的格式）
         ↓
第 3 步：如果改了本体或财务规则，还要跑 ontology:sync
         ↓
第 4 步：python3 05_control_evaluation/04_verifiers/validate_project.py
        （检查全库一致性）
```

## 最重要的三条禁忌

1. **不要在 06 里另写一套定义** — 06 只消费 01-05 的定义，不自己定义业务概念
2. **不要手工编辑 `src/generated/` 里的文件** — 这些是自动生成的，改了会被覆盖
3. **改了定义一定要跑 `domain:sync`** — 否则程序用的还是旧定义
4. **不要在 Runtime 写业务回退常量** — 状态、证据门槛、审批角色、知识晋级和评测案例必须来自 01-05 投影

## 允许的治理代码例外

`05_control_evaluation/04_verifiers/` 可以包含不参与产品请求的确定性校验器，用来验证 01-05 合同、投影和 Runtime 防漂移；这些校验器不得连接生产数据库、调用外部服务或实现研究执行。产品执行器、数据库写入和外部调用仍只能位于 06。

---

## 技术附录（给开发维护者）

| 项 | 值 |
|----|-----|
| 治理模式 | 01–05 定义，06 执行 |
| 生成投影 | `06_runtime/src/generated/domain-catalog.ts`（只读，可入 Git） |
| 漂移检测 | `npm run domain:check`（源文件指纹比对） |
| 跨域审计 | `npm run audit:domain`（Task/Scenario/Workflow/Capability/失效边引用 + Runtime 重复定义检查） |
| 发布切换审计 | `npm run audit:cutover` |

### 完整修改流程

1. 先修改上表对应的 01–05 权威文件。
2. 执行 `npm --prefix 06_runtime run domain:sync`，更新只读投影 `06_runtime/src/generated/domain-catalog.ts`。
3. 如涉及 Ontology 或财务规则，同步执行对应的 `ontology:sync` / 规则生成器。
4. 执行 `python3 05_control_evaluation/04_verifiers/validate_project.py`。

`src/generated/` 中的文件可入 Git，但不得手工编辑。`domain:check` 会用源文件指纹阻止漂移；`audit:domain` 还会检查 Task/Scenario/Workflow/Capability/失效边的跨域引用和 Runtime 重复定义。
