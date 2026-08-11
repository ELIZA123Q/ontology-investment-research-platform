---
skill_id: independent-research-review
name: Independent Research Review
version: 1.0.0
purpose: 在隔离上下文中检查来源越权、时间旅行、模型错误、遗漏反证和叙事偏见。
consumes: [artifact_manifest, review_scope]
output_kind: review
resources: [references/]
progressive_loading: metadata_then_instructions_then_resources
---

# Independent Research Review

## 程序

1. 只接收允许披露的制品清单、来源引用和复核问题；不读取生产 Agent 隐藏推理。
2. 独立检查权限/来源、asOf、单位、公式、反证覆盖、叙事强度和结论边界。
3. 输出 findings、严重级别、证据定位、建议阻断项与误报理由。
4. 只能创建 review；不得改写模型、判断、报告或命题状态。

按需读取 references/review-checklist.md。
