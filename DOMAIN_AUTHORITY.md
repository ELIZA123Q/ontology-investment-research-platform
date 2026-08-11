# 定义归属与 Runtime 投影规则

本仓库采用「01–05 定义，06 执行」。新的可复用知识、业务定义、能力元数据或治理参数不得只写在 `06_runtime` 中。

| 要改的内容 | 唯一写入位置 | 06 的责任 |
|---|---|---|
| 概念、词典、Ontology、图边与失效方向 | `01_semantic_knowledge/` | 读取生成投影，归一化、查询、写入受治理实例 |
| Intent、Scenario、Task motif、Role、Workflow Pattern | `02_scenario_task/` | 把 Problem Graph frontier 编译为可执行 TaskGraph |
| Agent、Skill、Tool、Protocol、Release | `03_agent_capability/` | 绑定 handler/provider，并在执行前检查 Release |
| Context、State、Memory、Workspace 合同与值域 | `04_context_state/` | 装配上下文、持久化状态并维护逻辑工作区 |
| 规则、阈值、权限、Verifier、Eval | `05_control_evaluation/` | 执行门禁、计算投影与记录 RuleEvaluation |
| UI、API、worker、store、handler、调度器 | `06_runtime/` | 唯一可执行实现；不成为业务知识权威 |

## 修改流程

1. 先修改上表对应的 01–05 权威文件。
2. 执行 `npm --prefix 06_runtime run domain:sync`，更新只读投影 `06_runtime/src/generated/domain-catalog.ts`。
3. 如涉及 Ontology 或财务规则，同步执行对应的 `ontology:sync` / 规则生成器。
4. 执行 `python3 05_control_evaluation/04_verifiers/validate_project.py`。

`src/generated/` 中的文件可入 Git，但不得手工编辑。`domain:check` 会用源文件指纹阻止漂移；`audit:domain` 还会检查 Task/Scenario/Workflow/Capability/失效边的跨域引用和 Runtime 重复定义。
