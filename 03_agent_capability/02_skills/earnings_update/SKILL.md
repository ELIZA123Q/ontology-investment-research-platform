---
skill_id: earnings-update
name: Earnings Update
version: 1.0.0
purpose: 比较实际值、公司指引、内部前值与有授权 vintage 的一致预期，并触发模型和命题更新。
consumes: [evidence_package, financial_model, thesis_state]
output_kind: thesis_state
resources: [references/]
progressive_loading: metadata_then_instructions_then_resources
---

# Earnings Update

## 程序

1. 冻结公告期、披露主体、实际值口径和一次性项目。
2. 分别比较实际值与内部前值、公司指引；只有存在授权来源、asOf 与 vintage 时才比较一致预期。
3. 分解差异为量、价、结构、费用、税、一次性项目及会计口径变化。
4. 记录模型修订、命题支柱影响、催化剂和失效条件。

## 不做

- 无 vintage 或授权通道时，禁止使用“超/低一致预期”或“beat/miss consensus”。
- 不把调整后口径与法定披露口径混合。

按需读取 references/earnings-update-contract.md。
