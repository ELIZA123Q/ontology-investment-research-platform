# 研究设计与报告协议

总控对完整A股权益研究要求 `ResearchDesign` 先于取证和假设形成。设计是事前问题树，不是研究结论；缺少信息截面、期限、主要矛盾、竞争假设、证据方案、停止条件或监测触发点时不得以占位文本通过。

运行时通过 `node_outputs` 按节点提交实际内容；CLI 可使用 `run PLAN_ID BUNDLE_ID --node-outputs outputs.yaml`。文件顶层使用 `design: [{type: ResearchDesign, properties: ...}]`，报告使用 `draft: [{type: DraftReport, properties: ...}]`。首次缺项而停止后，可以补齐文件并恢复同一计划；规划器只生成合同，不代写观点。

研究设计至少记录：`information_cutoff`、`horizon`、`decision_use`、`primary_question`、`main_contradiction`、`hypotheses`（一条主假设及至少一条竞争假设，各有可观察预测和反证）、`evidence_plan`（问题、优先来源、区分信号）、`framework_refs`、`framework_selection_reasons`、`stop_conditions`、`monitoring_triggers`。框架引用必须已登记，个人原则引用只能是已确认且适用的条目。未知事实写成待验证问题，不得凭设计阶段制造证据。

显式因果任务还必须在同一设计节点提交 `CausalDesign`，并由 `ResearchDesign.causal_design_refs` 准确引用。它至少冻结 A、B、分析单位、时间窗口、时滞、估计对象和反事实，同时预登记 A→B、B→A、共同原因及各自的可观察预测。具体字段和等级门槛以[通用因果识别 Skill](../../touyan-yinguo-shibie/SKILL.md)为准。

设计时依次问：宏观三问是否会改变目标判断；产业机制是否能传至受研究对象；公司层有无利润和现金兑现证据；市场已预期和计价了什么；是否达到 A10 的命题门槛。不相关层可以注明低相关性后停止，不得机械写满五层。

完整报告以现有 A10 为唯一投资命题裁决方法，呈现 `market_implied_view`、`research_difference`、`shortest_evidence_chain`、`decisive_falsifier`、`verification_window`、`thesis_status`。因果任务另须呈现 `causal_summary` 与 `causal_assessment_refs`，说明选中结构、被削弱或尚未排除的替代结构及表达上限。该结构只是结论表达，不额外降低证据或人工审批门槛。不得把分析师视角当作正式证据，也不得把成交或价格单一信号当成投资命题。
