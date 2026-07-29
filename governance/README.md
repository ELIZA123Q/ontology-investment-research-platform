# 治理（定位 · 合同 · 校验）

维护项目边界和质量规则。研究员日常做研究时，通常只需要两份：

1. [`01_架构/00_项目定位与边界.md`](01_架构/00_项目定位与边界.md) — 做什么、不做什么
2. [`03_校验/00A_高质量产出判别标准.md`](03_校验/00A_高质量产出判别标准.md) — 高质量自检

| 编号 | 目录 | 内容 |
|------|------|------|
| 01 | [`01_架构`](01_架构) | 项目定位、分层布局、[仓库地图与文件治理](01_架构/02_仓库地图与文件治理.md) |
| 02 | [`02_合同`](02_合同) | 跨阶段公共字段、状态、方法路由、回放合同 |
| 03 | [`03_校验`](03_校验) | 全局/阶段/发布校验脚本与说明 |
| 04 | [`04_路线图`](04_路线图/README.md) | 有时效的优化目标、实施账本与验收证据 |

规则归属以 [`02_合同/rule_authority_registry.yaml`](02_合同/rule_authority_registry.yaml) 为唯一登记表：正式本体约束通过 `RuleEvaluation` 执行，A01—A10 等研究方法通过 `MethodApplication` 使用，治理检查与运行控制不得支撑商业判断。执行 `python3 governance/03_校验/validate_rule_authority.py` 可检查正式约束、退役规则登记与 Runtime 分栏引用。

本体演进由独立的元治理控制面管理，不新增第四个业务本体域。边界与变更发布门见
[`02_合同/governance_control_contract.yaml`](02_合同/governance_control_contract.yaml)，
核心资产权威、责任角色和校验 Profile 见
[`02_合同/governed_asset_registry.yaml`](02_合同/governed_asset_registry.yaml)。
执行 `python3 governance/03_校验/validate_governance_control_plane.py` 可检查治理对象未进入正式本体、
候选受理与正式发布已分离，以及资产、消费面和发布门可解析。

本层不写业务方法正文，也不保存单次研究结论。
