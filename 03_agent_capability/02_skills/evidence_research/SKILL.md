---
skill_id: evidence-research
name: Evidence Research
version: 1.0.0
purpose: 提出证据需求、选择来源与获取通道、核验留痕、评估完整度并寻找反证。
consumes:
  - research-design outputs
  - 01_semantic_knowledge evidence ontology
allowed_tools:
  - source.discover
  - source.capture
  - source.query
  - semantic.search
output_kind: evidence_package
resources:
  - references/
  - templates/
  - registry.yaml
progressive_loading: metadata_then_instructions_then_resources
---

# Evidence Research

## 何时使用

已有判断结构或证据需求，需要把「要证明什么」落到来源选择、获取、核验与完备度评估时。

## 程序

1. 提出证据需求（对象、时间、口径、角色）。
2. 用来源选择材料（B00/B01/B02）与 `source_routes.yaml` 决定先找谁、怎么核验。
3. 通过 Tool（`source.query` / `source.discover` / `source.capture`）获取材料；MCP 只是连接协议。
4. 按模板留痕（connector、上游生产者、参数、快照、权限、时间）。
5. 评估相关性、可靠性、独立性与覆盖度；寻找反证与竞争解释材料。
6. 证据不足时显式降级，不得编造。

## 不做

- 不把 MCP 当成来源生产者
- 不在无 Source Capture 时形成 EvidenceFact
- 不做最终裁决（交给 `judgment-reasoning`）

## 资源加载顺序

1. 本文件
2. `registry.yaml`
3. `references/B00_*` / `B01_*` / `source_routes.yaml`
4. 领域材料：`references/domains/<domain>/`
5. 模板：`templates/`
