# 治理合同

这里放跨阶段、跨系统共用的**机器可读合同**：字段怎么叫、状态怎么迁、规则归谁、知识如何学习晋升等。它是「各方必须遵守的约定」，不是研报正文。

## 给谁看

- **研究员：** 通常可跳过；需要时看知识学习/高质量相关说明的人类版（在架构与校验目录）
- **维护者：** 改行为前必读对应 yaml 合同

## 材料从哪来

常见合同（本目录 yaml）：

| 合同 | 白话用途 |
|---|---|
| `public_contract.yaml` | 跨阶段公共字段与 ID 约定 |
| `knowledge_learning_contract.yaml` | 知识候选→评测→发布→使用 |
| `rule_authority_registry.yaml` | 规则归属唯一登记表 |
| `research_provenance_contract.yaml` | 研究溯源约定 |
| `artifact_editing_contract.yaml` | 中间制品直接编辑、确认、版本冲突与重算约定 |
| `report_generation_contract.yaml` | 专业定制研报规格、强制章节、个性化边界与交付生命周期 |
| `judgment_reasoning_commit_contract.yaml` | 证据→信号→假设→规则评估→正式判断的原子提交与审计边界 |
| `financial_data_ingestion_contract.yaml` | 行情/财务/预期数据的主体、指标、单位、时间口径与证据晋级边界 |
| `connector_ingestion_contract.yaml` | 实时网页、PDF、金融连接器的服务端认证、结果摄取、凭据隔离和局部重算边界 |
| `ai_report_drafting_contract.yaml` | 模型在正式判断、章节方法与证据边界内进行个性化草拟的合同 |
| `report_quality_evaluation_contract.yaml` | 运行时专业纪律诊断与正式 R/U/delta/S/C 评测准入边界 |
| `judgment_method_routes.yaml` / `judgment_threshold_policy.yaml` | 判断方法路由与阈值策略 |
| `runtime_*.yaml` | Runtime 映射与运行画像 |
| `governance_control_contract.yaml` 等 | 多为兼容指针；控制面事实源见元治理本体 |

人类可读总览仍从 [`../README.md`](../README.md)、[`../01_架构/`](../01_架构/README.md) 进入。

## 怎么用

1. 改跨域字段/状态前，先打开对应合同确认名称与枚举。
2. 知识闭环：人类读架构文，机器以 `knowledge_learning_contract.yaml` 为准。
3. 不要在合同里写单次研究结论。

## 怎么维护

- 新增合同放本目录并在治理 `registry.yaml` 登记。
- 规则归属只维护 `rule_authority_registry.yaml` 这一张总表。
- 改完运行：

```bash
python3 05_control_evaluation/03_校验/validate_project.py
python3 05_control_evaluation/03_校验/validate_rule_authority.py
python3 05_control_evaluation/03_校验/validate_knowledge_learning_contract.py
```

---

## 维护者附录（可跳过）

- 旧调用方可能仍读兼容合同文件；状态机事实源以现行权威（含元治理本体）为准
