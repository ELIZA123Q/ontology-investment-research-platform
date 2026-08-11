---
skill_id: sector-cycle-research
name: Sector Cycle Research
version: 1.0.0
purpose: 用供需、库存、价格、产能与产业链证据判断周期位置，并映射到公司。
consumes: [research_plan, evidence_package, research_lens]
output_kind: hypothesis_map
resources: [references/]
progressive_loading: metadata_then_instructions_then_resources
---

# Sector Cycle Research

## 程序

1. 冻结行业边界、区域、产品、期限与数据口径。
2. 建立供给、需求、库存、价格、利用率和产能的时间序列关系。
3. 判断周期位置及不确定性，并将变量映射到公司收入、利润和现金流。
4. 记录产能错配、库存口径冲突和需求替代等反证。

## 不做

- 不以单一价格或单一公司公告断言行业周期。
- 不将行业结论自动外推到每一家公司。

按需读取 references/cycle-contract.md。
