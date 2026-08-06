# 治理（定位 · 合同 · 校验 · 元治理本体）

维护项目边界和质量规则。研究员日常做研究时，通常只需要两份：

1. [`01_架构/00_项目定位与边界.md`](01_架构/00_项目定位与边界.md) — 做什么、不做什么
2. [`03_校验/00A_高质量产出判别标准.md`](03_校验/00A_高质量产出判别标准.md) — 高质量自检

| 编号 | 目录 | 内容 |
|------|------|------|
| 00 | [`01_架构/00_五域系统骨架.md`](01_架构/00_五域系统骨架.md) | Agent-native 五域职责与目录评估 |
| 01 | [`01_架构`](01_架构) | 项目定位、分层布局、[仓库地图与文件治理](01_架构/02_仓库地图与文件治理.md) |
| 02 | [`02_合同`](02_合同) | 跨阶段公共字段、状态、方法路由、回放合同（目标壳 `rules/`） |
| 03 | [`03_校验`](03_校验) | 全局/阶段/发布校验（目标壳 `verifiers/`） |
| 04 | [`04_路线图`](04_路线图/README.md) | 优化目标与实施账本（含五域迁移账本） |
| 05 | [`05_元治理本体`](05_元治理本体/README.md) | 本体演进的对象、关系、Action、规则与治理实例图 |
| 壳 | `rules/` `identity/` `permissions/` `evals/` `verifiers/` | 五域 Governance 内部分层目标壳（`status: shell`） |

规则归属以 [`02_合同/rule_authority_registry.yaml`](02_合同/rule_authority_registry.yaml) 为唯一登记表：正式本体约束通过 `RuleEvaluation` 执行，A01—A10 等研究方法通过 `MethodApplication` 使用，治理检查与运行控制不得支撑商业判断。执行 `python3 governance/03_校验/validate_rule_authority.py` 可检查正式约束、退役规则登记与 Runtime 分栏引用。

本体演进由 [`05_元治理本体`](05_元治理本体/README.md) 管理，不新增第四个投研业务本体域。
它用对象、关系、Action、规则和实例图表达 Branch—Proposal—Impact—Approval—Validation—Migration—Release 闭环。
`02_合同/governance_control_contract.yaml` 与 `governed_asset_registry.yaml` 仅为旧调用方保留兼容指针。
执行 `python3 governance/03_校验/validate_governance_control_plane.py` 可检查治理模型闭包、
Action 生命周期、实例关系、资产权威与正式本体隔离。

本层不写业务方法正文，也不保存单次研究结论。
