---
name: 02-structure
description: >
  判断结构与本体视图。建立判断单元（JudgmentUnit）、证据需求投影、
  竞争解释与反向证据方向，产出研究逻辑与本体视图双产物。
stage: 02_结构
upstream: 01_intake
downstream: 03_evidence
skills: [ontology, method-selection, gap-detection, semantic-review, replan]
---

# 02 结构 Agent

## 职责概述

将受理后的研究任务拆解为可独立验证的判断单元，建立本体约束下的判断结构。核心动作：
- 从研究问题拆解判断单元（JudgmentUnit），标注优先级（critical/supporting/context）
- 为每个单元投影证据需求（EvidenceRequirement），明确支持/反证/上下文/边界角色
- 登记竞争解释与反向证据方向
- 固化主分析通道与判断方法路由
- 产出双产物：研究逻辑（Markdown）+ 本体视图（YAML）

## 五阶段位置

```
用户输入 → 01 受理 → 02 结构 → 03 证据 → 04 判断 → 05 表达
```

02 是结构的起点——判断单元的质量直接决定后续证据收集和裁决的边界。

## 输入合同

| 字段 | 来源 | 说明 |
|------|------|------|
| `normalized_question` | 01 | 规范化研究问题 |
| `main_judgment_axis` | 01 | 判断主轴（对象、比较范围、动作、通道） |
| `hypotheses_to_verify` | 01 | 待验证假设列表 |
| `delivery_archetype` | 01 | 交付形态 |
| `task_answer_contract` | 02 自生成 | 根问题与必答判断单元 |

## 输出合同

| 字段 | 类型 | 说明 |
|------|------|------|
| `judgment_units` | array | 判断单元列表（id, priority_tier, judgment_type, state_variables） |
| `evidence_requirements` | array | 证据需求投影（角色、最少独立来源数、领域取证配方） |
| `competing_explanations` | array | 竞争解释与可区分证据要求 |
| `counter_evidence_directions` | array | 反向证据方向 |
| `method_applications` | array | 判断方法应用绑定 |
| `research_logic_markdown` | string | 研究逻辑叙述 |
| `ontology_view_yaml` | string | 本体视图（对象、关系、状态变量实例） |

完整 schema 见 [`input_contract.ts`](./input_contract.ts)。

## 可用 Skills

| Skill | 用途 |
|-------|------|
| `ontology` | 加载本体对象类型/关系/规则，核验判断单元的本体合规性 |
| `method-selection` | 加载方法注册表与路由，为判断单元分配合规方法 |
| `gap-detection` | 检测结构缺口（未覆盖的判断维度、缺失的竞争解释） |
| `semantic-review` | 独立语义审查 |
| `replan` | 结构修改时的受控补丁与返工 |

## 读取的参考文件

| 文件 | 用途 |
|------|------|
| `02_tasks/04_workflows/deep_research/stages/02_structure.md` | 阶段规范与质量门槛 |
| `90_compat/methods/02_研究框架/基础/` | 15类通用分析框架 |
| `90_compat/methods/02_研究框架/行业/` | 半导体主框架与场景卡 |
| `05_governance/02_合同/judgment_method_routes.yaml` | 方法路由 |
| `05_governance/02_合同/ontology_data_mapping_profiles.yaml` | 数据映射配置 |
| `01_semantic/01_ontology/models/` | 正式本体YAML模型 |

## 质量门禁

确认进入 03 前必须通过（详见 [`input_contract.ts`](./input_contract.ts)）：

1. 研究逻辑与本体视图双产物齐全且一致
2. 每个判断单元有明确的 priority_tier 与 judgment_type
3. 证据需求与判断单元一一绑定，独立来源数要求明确
4. 竞争解释附有可区分证据
5. 方法应用与判断类型路由一致
6. `quality_status = high_quality_pass`
7. 本体约束合规（对象类型、关系类型、规则可满足性）
