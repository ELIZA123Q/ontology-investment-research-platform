# 规则 — 系统必须遵守什么

> 上级目录：[`05_control_evaluation/`](../README.md) | 根目录：[`README.md`](../../README.md)

这里保存系统必须遵守的公共约束、阈值和知识晋升规则。好比投研团队的合规手册——什么必须做、什么不能做、什么需要审批。

## 里面有什么

| 子目录 | 一句话说明 |
|--------|-----------|
| `policies/` | **策略**：规则权威、参数权威、判断阈值、方法路由、财务模型完整性、模型数据出境、能力激活、修改沉淀、信号证据准入 |
| `contracts/` | **合同**：跨阶段公共语义与包类型 |
| `knowledge_promotion/` | **知识晋升规则**：候选 → 评测 → 发布 → 使用 |

> 规则是否被满足由 [`../04_verifiers/`](../04_verifiers/README.md) 判定；规则带来的研究价值由 [`../05_evals/`](../05_evals/README.md) 评估。

## 怎么维护

- 只保存 Control Plane 拥有的公共约束
- 研究规划、取证、报告与 Runtime 合同分别跟随各自的 owner 目录
- 不要把其他域的合同副本复制到这里
- 新增规则先写入此处唯一权威资产，再登记 `rule_authority_registry.yaml` 与 `parameter_authority_matrix.yaml`；Runtime 如需读取，只能执行生成投影，并把防漂移检查加入项目门禁
- 任何实质修改先按 `policies/change_deposition_policy.yaml` 分类：稳定语义进本体、确定性约束进 Rule、研究过程进 Method/Skill、一次性事实进任务或案例、质量发现进 Eval、纯执行改动进 Runtime；每项都在 `change_records/` 留下权威、执行和验证引用
- 在开始实质修改前，运行 `python3 05_control_evaluation/04_verifiers/classify_change.py --list` 查看路由；明确选择后，可用 `--classification <路由> --summary "..."` 生成只读的沉淀计划与变更记录骨架。分类必须由修改者作出，工具不会用文件名或代码位置猜测业务语义。
