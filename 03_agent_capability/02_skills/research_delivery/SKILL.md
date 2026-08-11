---
skill_id: research-delivery
name: Research Delivery
version: 1.0.0
purpose: 将已验证证据与判断组织为边界清晰的交付物（快答、研报、判断卡、图表、过程视图等）。
consumes:
  - judgment-reasoning outputs
  - evidence-research packages
output_kind: report
resources:
  - references/
  - templates/
progressive_loading: metadata_then_instructions_then_resources
---

# Research Delivery

## 何时使用

判断已形成（或显式降级），需要输出研究员可消费的交付物时。

## 程序

1. 只使用正式制品与已验证来源。
2. 区分事实、推断与观点；保留不确定性和改判条件。
3. 按交付形态选择模板和 `expression_presets.yaml` 的表达 preset（事件点评、周期判断、公司业绩、主题深度等）。
4. 不得新增未经取证/裁决确认的事实。

## 不做

- 不重新做取证或裁决
- 不把「写文章」当成唯一交付形态
- 不生成任意不可信 HTML/JS

## 资源加载顺序

1. 本文件
2. `references/standards/`
3. `expression_presets.yaml`（仅控制交付形式）
4. 按需加载 `templates/`
