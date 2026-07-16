# 运行校验与阶段模板索引

本目录存放跨阶段共用的校验工具；各阶段正式模板在对应阶段目录的 `模板/` 下。阶段边界与最小跨阶段引用约定（`Q/JU/ER/EV/C/RC/EX`）见 [00_项目定位与边界.md](../00_全局/00_项目定位与边界.md#51a-最小跨阶段引用约定)，阶段质量门槛见各阶段规范，正式发布规则见 [00A_高质量产出判别标准.md](../00_全局/00A_高质量产出判别标准.md)。

00A 单独保留：01—05 共用其全局质量原则和正式发布规则；各阶段的 `quality_gate_ref` 仍指向该阶段自己的规范。

## 1. 各阶段文件

| 阶段 | 面向研究员的文件 | 结构化文件 | 文件含义 |
|---|---|---|---|
| 01 | 01-主题投研需求说明-日期-序号.md | 无 | 投研需求说明；不读取、引用或受制于本体 |
| 02 | 02-主题研究逻辑-日期-序号.md | 02-主题本体视图-日期-序号.yaml | 研究逻辑 + 本次任务跨三域所需的本体范围 |
| 03 | 03-主题数据与证据准备-日期-序号.md | 03-主题语义域与证据域实例清单-日期-序号.yaml + 快照目录 | 语义实例、证据实例、固定推理输入，以及各核心判断的证据是否够用 |
| 04 | 04-主题判断简报-日期-序号.md | 04-主题推理审计-日期-序号.yaml | 2—4 页判断定稿 + 完整推理留痕 + 是否允许进入 05 表达 |
| 05 | 05-主题报告类型-日期-序号.md | 05-主题表达审计-日期-序号.yaml + 05-主题独立语义审查-日期-序号.yaml | 最终研究稿 + 确定性表达审计 + 独立语义校验 |
| 事后复盘（非新增核心阶段） | 无固定正文 | 研究复盘记录，按 `04_推理/模板/研究复盘记录模板.yaml` | 对原判断追加兑现结果、错误归因和学习建议，不覆盖原留痕 |

01 新运行使用 `judgment_task / 1.5.0`：除比较范围、时间三件套和交付深度外，必须提供 `task_scope_contract`。02 使用逻辑 `1.2.0` / 视图 `2.2.0`，冻结 `scope_graph`、稳定命题键、父子聚合合同及证据回环合同；03 继续使用 `1.4.0` 快照，并要求语义/证据实例清单 `3.0.0` 以 `business_instance_graph` 为权威、CSV 为只读投影；04 审计使用 `4.0.0` 实例图；05 表达审计使用 `2.6.0`。旧专用列表权威格式不再兼容。

发布采用双层校验：确定性链通过但独立语义审查缺失时为 `STAGE_READY`；确定性失败或语义审查 `fail/needs_human` 时为 `RETURN_REQUIRED`；两层均通过且输入哈希有效时才为 `PUBLISHABLE`。新运行使用 `run_manifest / 1.2.0`：每阶段保留 current、pending、history 与 `supersedes_attempt`，证据循环还记录 wave、plan 和对象 stale；跨运行增量仍绑定真实父清单路径与哈希，并逐稳定 Claim 填写更新登记。

跨阶段公共字段、枚举、判断类型和状态以 [`public_contract.yaml`](../00_全局/contracts/public_contract.yaml) 为准，判断类型到 03/04 方法的默认与允许路由以 [`judgment_method_routes.yaml`](../00_全局/contracts/judgment_method_routes.yaml) 为准。02 本体视图须同时包含 semantic_scope、evidence_contract 和 reasoning_plan，并为每个 JU 生成 `content_hash`。03、04 必须继承该 JU 的类型和哈希，发现错误只能返回 02。

复盘沿用一级推理本体的 ValidationRecord。04 先写 review_plan，复盘到期后再按模板追加原 Claim、预期信号、实际信号、结果、error_type 与 learning_targets；复盘不是第六个核心规范，也不回写历史判断。

## 2. 03 快照目录

新运行统一使用以下结构：

~~~text
03-主题数据与证据快照-日期-序号/
├─ manifest.csv
├─ 01_plan/              证据需求、配方、篮子、来源画像和取数通道
├─ 02_assets/            来源、规范化证据链、语义实例和固定推理输入
├─ 03_gate/              各判断证据是否够用、J0—J4 判断上限、覆盖、路径和缺口
└─ 04_05_materials/      图表、表格、来源注释和研报素材是否就绪
~~~

关键文件：

- source_documents → evidence_claims → evidence_facts 是规范化证据链；
- `raw_artifact_ref` 优先指向快照内保存的原始 PDF、网页响应、表格或接口返回；确因许可、访问或存储限制无法保存原文时，可用透明标记的 `structured_evidence_packet` 保存来源定位、取证记录和已录入主张，但必须声明 `raw_content_included=false`；
- evidence_assessments 记录单项证据在本任务中的可用性；
- evidence_readiness_assessments 记录各判断单元是否足以进入 04；
- evidence_readiness_assessments 只记录 `evidence_grade`、反证归一化结果与关联路径；J 上限由统一矩阵计算；
- reasoning_inputs 只是 03 固定的 Observation / Event 等输入，不包含 RuleEvaluation 或 Judgment；
- evidence_records.csv 汇总原子证据的任务级使用属性，供证据是否够用与判断强度校验；其来源主张与事实仍须回溯到规范化证据链。

## 3. 证据质量底线

03 达到高质量通过，至少要做到：

1. 每条 EvidenceClaim 可回到 SourceDocument 和原文位置；
2. 每条 EvidenceFact 可回到一条或多条 EvidenceClaim；
3. 主结论有直接支持证据，J3 至少有两组独立来源；
4. 反证、替代解释、冲突、时点和范围均已检查；
5. 预测或条件情景不得达到 J4；
6. 数据图表有期间、口径、单位、来源和实际/预测属性；
7. 证据不足时降低判断等级或退回补证，不用覆盖率包装证据缺口。

图表、表格和来源注释是否就绪，不属于上述证据质量底线；须另读 `delivery_readiness.csv`。`delivery_readiness` 只回答素材有没有、是否可用、限制是什么；用不用、放在哪里、如何形成论证由 05 决定。不适用图表的任务，可在证据高质量时把 `chart_readiness` 标为 `not_applicable`。

## 4. 05 真实研报模板

05A—05E 分别对应事件点评、行业动态点评、行业周期判断、公司业绩点评和主题深度研究。五类模板使用同一套真实研报底座：

~~~text
判断型标题
→ 投资要点
→ 核心结论概览
→ 2—5 个结论型正文论点
→ 投资含义与重点观察
→ 催化、验证与风险
→ 主要资料来源
→ 口径说明与合规声明
~~~

正文不出现本体 ID、判断单元 ID、质量状态码、证据门槛名称或系统自检表。系统追溯放在 03、04 和 05 表达审计中。

## 5. 校验命令

~~~bash
python3 01_任务受理/validate_01_outputs.py <01需求说明.md>
python3 01_任务受理/validate_01_rejection.py <01不予受理说明.md>
python3 02_判断结构/validate_02_outputs.py <02研究逻辑.md> <02本体视图.yaml>
python3 02_判断结构/validate_02_gap_note.py <02本体缺口说明.md> [<02研究逻辑.md> <02本体视图.yaml>]
python3 03_数据与证据/validate_03_outputs.py <03数据与证据准备.md> <03快照目录>
python3 03_数据与证据/validate_delivery_readiness.py <03快照目录>
python3 03_数据与证据/freeze_source_captures.py <03快照目录>
python3 04_推理/validate_04_outputs.py <04判断简报.md> <04推理审计.yaml> <03快照目录>
python3 05_表达交付/validate_05_outputs.py <05研报.md> <报告类型中文名> <05表达审计.yaml> <04推理审计.yaml>
python3 运行校验/research_loop.py --view <02本体视图.yaml> --wave <冻结证据波次.yaml> --dependency-projection <对象依赖投影.yaml>
python3 运行校验/validate_run.py <运行目录>
~~~

报告类型中文名为：事件点评、行业动态点评、行业周期判断、公司业绩点评或主题深度研究。

新 run 首次建立阶段哈希基线时执行 `python3 运行校验/validate_run.py <运行目录> --initialize`。之后常规校验不得覆盖基线；任一上游变化会把当前及下游阶段标记为 `stale`，合同、本体或关键知识库版本变化标记为 `revalidation_required`。

闭环计划确认后，可在命令中追加 `--manifest <运行目录>/run_manifest.yaml --apply-manifest`。控制器会先把即将被替代的 current attempt 复制到 `.research_attempts/stage_xx/attempt-nnnn/`，再建立 pending attempt；不会覆盖历史 archive。完成某阶段并通过该阶段完整 `high_quality_pass` 后，显式执行：

```bash
python3 运行校验/validate_run.py <运行目录> --commit-stage stage_02
python3 运行校验/validate_run.py <运行目录> --commit-stage stage_03
python3 运行校验/validate_run.py <运行目录> --commit-stage stage_04 --commit-stage stage_05 --loop-state <loop_state.yaml>
```

最后一个 pending attempt 提交时必须绑定 `loop_state.yaml`；校验器会核对其文件哈希，并重新计算收敛状态。`critical stale`、未完成 attempt 或未解决冲突任一存在时，不允许将运行标记为已收敛。

总校验分别输出 `quality_pass`、`publishable`、`judgment_level` 和 `directional_conclusion_available`。J0/J1 的高质量缺口或观察报告可以发布；发布不要求必须形成强方向结论。

项目级正式验收统一在根目录执行：

~~~bash
python3 validate_project.py
~~~

该命令同时检验示例1和示例2的现行 01—05 全链（从需求到研报）。示例1覆盖行业周期判断，示例2覆盖主题深度研究；两者都应返回 `PUBLISHABLE`（可正式交付）。

## 6. 校验边界

校验器负责文件命名、字段与枚举、跨文件引用、来源独立性、反证、判断强度、04 不超过 03、05 不超过 04、范围与条件不丢失、关键观点登记和返工去向；并检查阶段产物与知识库绑定：02 `judgment_type` 必须为公共合同原子类型，03 使用 `kb03:` 方法引用，04 使用 `kb04:` 方法引用并记录理由，05 允许转述和综合但不得新增研究主张。

校验器不能代替研究员判断资料是否真实充分、比较口径是否合理、推理是否有经济含义、标题是否真正有增量。正式发布以各阶段规则校验与 00A 发布条件为准；内容质量由执行者自行把关，不作为仓库内强制产物。

## 7. 本体驱动证据闭环

闭环的三个 sidecar 模板位于 [`运行校验/模板`](模板/)：

- `evidence_wave.template.yaml`：冻结一个证据批次，并把 delta 映射到正式本体 Object / Relation；
- `dependency_projection.template.yaml`：记录正式本体对象之间的失效传播方向，ReportClaim 边仅允许 `stageProjection`；
- `loop_state.template.yaml`：记录结构触发、critical stale、attempt 哈希、冲突与最新波次变化，用于语义收敛。

分类与返工是自动派生的：根问题、研究范围或任务目标变化回 01；未知变量、路径、竞争假设或结构关系回完整 02；既有结构内证据回 03 并重算受影响 04；纯表达变化回 05；相同 wave hash 幂等。控制器不接受 `max_iterations`、`max_loop_count` 或 `iteration_limit`，因为循环是否结束取决于结构触发、对象 stale、哈希、冲突和关键判断/路径是否稳定，而不是执行次数。

对象 stale 按依赖图传递：

```text
EvidenceClaim / EvidenceFact
→ Observation / Event / Signal / MarketExpectation
→ Hypothesis
→ RuleEvaluation
→ Judgment
→ ExpectationGap / AssetImpact
→ ReportClaim
```

这些文件只决定“重跑什么”，不决定“业务上是什么”。正式对象、关系、动作、变量和规则仍分别以一级/二级本体和 02 冻结视图为唯一权威；`reasoningSupersedes` 与 `ReviseReasoningObject` 是推理修订的唯一正式入口。
