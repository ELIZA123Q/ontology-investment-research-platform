---
skill_id: judgment-reasoning
name: Judgment Reasoning
version: 1.0.0
purpose: 在合格证据上建立主假设、竞争解释、因果链、反证、情景与判断强度。
consumes:
  - evidence-research outputs
  - research-design method applications
output_kind: hypothesis_map
resources:
  - references/
progressive_loading: metadata_then_instructions_then_resources
---

# Judgment Reasoning

## 何时使用

证据包可用，需要对状态/趋势/机制/归因/传导/分化/影响/预期差/投资命题形成可审计判断时。

## 程序

1. 绑定判断单元与已冻结证据。
2. 列出主假设与竞争解释。
3. 评估支持、削弱（weakening）与阻断（blocking）信号。
4. 形成判断强度与不确定性声明；定义改判条件。
5. 无合格证据时必须降级，不得假装高置信。

## 不做

- 不回头伪造证据
- 不把表达润色当成裁决
- 不绕过 Verifier / Control 门槛

## 资源加载顺序

1. 本文件
2. `references/A00_裁决总则.md` 与相关附录
3. 按判断类型加载 `A01`–`A10`
