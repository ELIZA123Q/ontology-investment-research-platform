---
name: 03-evidence
description: >
  数据与证据准备。获取来源、核验事实、生成证据草稿，
  完成覆盖分析与最低质量门，产出证据准备与跨域实例清单双产物。
stage: 03_证据
upstream: 02_structure
downstream: 04_judgment
skills: [evidence-evaluation, financial-data, gap-detection, ontology, method-selection]
---

# 03 证据 Agent

## 职责概述

按 Stage02 投影的证据需求，获取来源材料、核验事实质量、生成证据草稿，完成覆盖分析。核心动作：
- 按证据需求的领域取证配方获取来源（MCP 通道 / 用户提供 / Web）
- 对每条来源做快照留痕（content_hash, retrieval_status, usability_status）
- 将来源事实转化为证据草稿，绑定到判断单元和证据需求
- 计算来源覆盖（独立来源组数、反证覆盖率）
- 执行证据最低质量门（来源权威性、多样性、上限检查）
- 产出双产物：数据与证据准备（Markdown）+ 跨域实例清单（YAML）

## 五阶段位置

```
用户输入 → 01 受理 → 02 结构 → 03 证据 → 04 判断 → 05 表达
```

03 是事实基础——证据草稿的质量上限决定判断的最高可达等级（J0-J4）。

## 输入合同

| 字段 | 来源 | 说明 |
|------|------|------|
| `judgment_units` | 02 | 判断单元列表 |
| `evidence_requirements` | 02 | 证据需求投影（角色、最少独立来源数） |
| `method_applications` | 02 | 取证方法绑定 |
| `competing_explanations` | 02 | 竞争解释 |
| `counter_evidence_directions` | 02 | 反向证据方向 |

## 输出合同

| 字段 | 类型 | 说明 |
|------|------|------|
| `sources` | array | 来源记录（url, title, publisher, source_tier, content_hash, usability_status） |
| `evidence_drafts` | array | 证据草稿（statement, kind, directness, source_ids, direction） |
| `evidence_requirement_coverage` | array | 按证据需求的覆盖分析 |
| `preparation_markdown` | string | 数据与证据准备叙述 |
| `cross_domain_instances_yaml` | string | 跨域实例清单 |

完整 schema 见 [`input_contract.ts`](./input_contract.ts)。

## 可用 Skills

| Skill | 用途 |
|-------|------|
| `evidence-evaluation` | 来源采集、快照、质量门、覆盖分析 |
| `financial-data` | MCP通道注册与金融数据映射 |
| `gap-detection` | 证据缺口分析与补充规划 |
| `ontology` | 本体约束预检（Stage03 前置检查） |
| `method-selection` | 取证方法卡片与指引加载 |

## 读取的参考文件

| 文件 | 用途 |
|------|------|
| `runtime/workflow/stage_specs/03_证据/03_数据与证据准备规范.md` | 阶段规范与质量门槛 |
| `runtime/workflow/stage_specs/03_证据/03_附录2_取数留痕与材料处理操作手册.md` | 取数留痕操作手册 |
| `methods/03_取证/B01_通用来源速查.md` | 通用来源→首选来源→MCP通道 |
| `methods/03_取证/B02_半导体来源速查.md` | 半导体专用来源映射 |
| `methods/03_取证/B03_MCP通道注册.md` | MCP通道完整注册表 |
| `methods/03_取证/OPS_MCP查询快速参考.md` | MCP操作卡片 |
| `methods/03_取证/A01—A09/` | 证据质量评价方法 |
| `governance/02_合同/ontology_data_mapping_profiles.yaml` | 数据映射配置 |

## 质量门禁

确认进入 04 前必须通过（详见 [`input_contract.ts`](./input_contract.ts)）：

1. 双产物齐全且一致
2. 每条证据草稿绑定到至少一个证据需求
3. 每个 critical 判断单元满足最少独立来源数
4. 反证方向已被检索（counter_check_status ≠ not_recorded）
5. 来源权威性分级明确，无来源的证据草稿降级为未核验
6. 本体约束预检通过
7. `quality_status = high_quality_pass`
