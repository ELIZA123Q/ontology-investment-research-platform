---
name: evidence-evaluation
description: >-
  03阶段证据采集、快照与质量评估。公开来源抓取、MCP数据通道调用、
  证据草稿归一化、来源覆盖分析、最低质量门禁。
  Use when user asks to "获取来源" "采集证据" "核验来源" "快照留痕"
  "评估证据质量" "计算覆盖" or mentions 03阶段取证, source acquisition,
  evidence quality gate, source coverage.
allowed-tools: Read, Bash, WebFetch
---

# 证据采集与评估

## 触发条件

- Stage03 证据准备：获取、快照、核验来源材料
- 需要计算证据覆盖与最低质量门
- 需要评估来源权威性分级

## 使用流程

1. 从 Stage02 获取 `evidence_requirements`（证据需求投影）
2. 确定取证配方：读取 `methods/03_取证/B01_通用来源速查.md` 或 `B02_半导体来源速查.md`
3. 匹配 MCP 通道：读取 `methods/03_取证/B03_MCP通道注册.md`
4. 获取来源数据（WebFetch / MCP），每次调用后填写留痕
5. 执行最低质量门检查
6. 计算覆盖分析（独立来源组数、反证覆盖率、证据上限）

## 核心约束

- **MCP 是获取通道，不是来源生产者**（03规范 2.5节）
- 每条来源必须留痕：connector、upstream_source、query_params、content_hash、replay_capable
- 无来源的证据草稿降级为未核验（gap）
- 证据上限决定 Stage04 最高可达判断等级（J0-J4）

## 留痕模板

每次数据获取后立即填写：
```yaml
connector: ""           # MCP名称
upstream_source: ""     # 原始生产者
query_params: {}        # 完整调用参数
raw_response_ref: ""    # 原始响应保存位置
field_lineage: {}       # 关键字段→原始响应字段路径
access_scope: "公开"
replay_capable: true
obtained_at: ""         # ISO 8601
```

## 知识库引用（不复制，直接读取）

| 需要什么 | 读取位置 |
|---------|---------|
| 通用来源速查 | `methods/03_取证/B01_通用来源速查.md` |
| 半导体来源速查 | `methods/03_取证/B02_半导体来源速查.md` |
| MCP通道注册 | `methods/03_取证/B03_MCP通道注册.md` |
| MCP操作参数 | `methods/03_取证/OPS_MCP查询快速参考.md` |
| Web回退路径 | `methods/03_取证/OPS_通用真实来源查询与回退手册.md` |
| 证据质量评价方法 | `methods/03_取证/A01—A09/` |
| 来源准入原则 | `methods/03_取证/B00_来源选择与使用边界.md` |
| 03阶段规范 | `runtime/workflow/stage_specs/03_证据/03_数据与证据准备规范.md` |
| 取数留痕手册 | `runtime/workflow/stage_specs/03_证据/03_附录2_取数留痕与材料处理操作手册.md` |
| 数据映射配置 | `governance/02_合同/ontology_data_mapping_profiles.yaml` |
| 实现代码 | `runtime/skills/evidence_evaluation/` |

## 质量门禁

- 每条证据草稿绑定到至少一个 evidence_requirement_id
- 每个 critical 判断单元满足最少独立来源数
- 反证方向已被检索（counter_check_status ≠ not_recorded）
- 来源权威性分级明确
- 本体约束预检通过（调用 ontology skill）
