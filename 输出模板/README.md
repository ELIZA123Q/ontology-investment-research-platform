# 输出模板

01—05 的总体分工和正式产物见 [`00_项目定位与边界.md`](../00_项目定位与边界.md)。本目录保存各类产物的结构、字段、填写说明，以及配套的 Python 确定性校验器。

当前 01 输出模板版本为 `1.1.0`，新增不可跳过的三项用户交互确认硬门；04、05 保持 `1.0.0`；02 判断结构交接 schema 为 `1.1.0`；03 数据证据快照 schema 为 `1.2.0`。2026-07-10 之前生成的 01 v1.0 历史产物仅作兼容，不得用于新运行绕过交互门。

## 0. 填写要求与机器校验

模板与各阶段规范描述的是**完整填写要求**；`validate_*.py` 只 enforce **第一层确定性校验**（结构、命名、引用链、枚举、跨文件一致性）。高质量语义要求见 [`00A_高质量产出判别标准.md`](../00A_高质量产出判别标准.md)，目前**不 automate**，依赖人工独立语义审阅。

| 层级 | 来源 | Python 覆盖 |
|------|------|-------------|
| 结构契约 | 模板 YAML/CSV 字段、正文小节标题、文件命名三元组 | **各阶段 validator + `validate_publish.py`** |
| 引用与枚举 | 跨阶段 ID、配对关系、`allowed_04_output` / `admission` 等 | **03/04/05 较强；01/02 部分** |
| 业务语义 | 主判断轴、状态变量链、路径推理结果、正文写作质量 | **规范与模板要求填写；多数未代码校验** |
| 独立语义审阅 | `00A` 第二层门禁 | **无 automate**；仅检查 `quality_status` 等状态字段 |

**原则：** 通过 validator 表示「契约完整、可流转」；不等于「高质量可用」或「可正式发布」。正式发布另需各阶段 `quality_status=high_quality_pass`（见 §6）。

### 0.1 校验器清单

| 脚本 | 用法 |
|------|------|
| `validate_01_outputs.py` | `python3 输出模板/validate_01_outputs.py <投研需求说明.md>` |
| `validate_01_rejection.py` | `python3 输出模板/validate_01_rejection.py <不予受理说明.md>` |
| `validate_02_outputs.py` | `python3 输出模板/validate_02_outputs.py <研究逻辑.md> <本体视图.yaml>` |
| `validate_03_outputs.py` | `python3 输出模板/validate_03_outputs.py <数据与证据准备.md> <快照目录>/` |
| `validate_04_outputs.py` | `python3 输出模板/validate_04_outputs.py <推理报告.md> <推理审计.yaml> <快照目录>/` |
| `validate_05_outputs.py` | `python3 输出模板/validate_05_outputs.py <05研报.md> <01需求.md> <04审计.yaml> <快照目录>/` |
| `validate_publish.py` | `python3 输出模板/validate_publish.py <运行目录>` |

共享工具：`validator_utils.py`、`quality_gate_utils.py`、`snapshot_layout_03.py`。

---

## 1. 01 模板

- `01_投研需求说明模板.md` 文首「模板使用说明」集中保存通过版的 YAML 字段、文件命名、动态范围填写规则与完成检查；正式文件命名为 `01-<核心主题>投研需求说明-<YYYYMMDD>-<当日序号>.md`。
- `01_不予受理说明模板.md` 文首保存不予受理版的精简 YAML 与正文要求；正式文件命名为 `01-<核心主题>不予受理说明-<YYYYMMDD>-<当日序号>.md`。
- 正式生成文件时不得输出模板维护说明。

### 1.1 填写要求（规范 + 模板，含未机器校验项）

- `main_judgment_axis`、`overscope_check`：`ready_for_matching` 时 `overscope_check.status` 必须为 `pass`（见 [`01_投研判断任务受理与整理规范.md`](../01_投研判断任务受理与整理规范.md)）。
- `user_confirmation`：必须来自真实用户对话，至少覆盖核心对象、事件/政策口径与时间窗口、05 交付落点三项确认；未确认不得进入 02。
- `quality_gate_ref`、`deterministic_check_status`、`semantic_review_status`、`return_required` / `return_stage`：双层门禁与返工留痕。
- 正文须与 YAML 一致（主判断轴、范围收敛、核心问题等）。

### 1.2 机器校验（`validate_01_outputs.py` / `validate_01_rejection.py`）

**已 enforce：**

- 文件命名三元组；YAML 核心必填字段，含 `user_confirmation`、`main_judgment_axis`、`overscope_check`、`needs_split`、双层门禁状态与返工字段。
- 新运行必须使用 01 schema `1.1.0`；校验器要求至少三项真实问答、三个必需确认主题、确认时间及时区。门禁生效前的 `1.0.0` 历史产物按生成时间兼容。
- `document_type`、`status=ready_for_matching`（通过版）/ `out_of_scope`（不予受理版）、`quality_status` 枚举。
- `normalized_question`、`scope_summary` 非空；`judgment_landing`、`task_type.primary`、`delivery_archetype.primary` 枚举。
- `main_judgment_axis` 完整性、`overscope_check.status=pass` 与 `ready_for_matching` 的一致性；禁止“综合影响/全链分析/多主线并列”等可机器识别的过宽表达。
- 通过版 10 个正文小节标题；拒收版范围过大时必须给出可拆主判断轴；禁止提前写入下游阶段 marker。

**未 enforce（须人工或后续补校验）：**

- YAML 与正文的完整语义一致性。
- `00A` 高质量语义审阅中无法可靠机器判断的部分（观察维度判别力、是否真的保留研究员意图等）。

---

## 2. 02 模板

- `02_研究逻辑模板.md` 面向研究员，重点解释问题拆解、关键判断、判断路径、反证和证据计划；它不是 YAML 的文字版。
- `02_判断结构与本体视图模板.yaml` 面向系统，保存本体引用、路径节点、实例需求、证据要求、任务候选、缺口风险和 `validation` 自检块。
- 正式文件分别命名为 `02-<核心主题>研究逻辑-<YYYYMMDD>-<当日序号>.md` 和 `02-<核心主题>本体视图-<YYYYMMDD>-<当日序号>.yaml`；两者必须使用相同主题、日期和序号。
- 两份产物必须共享任务身份和逻辑 ID，并完成双向定位；技术校验统一保存在本体视图 YAML 的 `validation` 中，不进入研究逻辑正文。
- `02_本体缺口说明模板.md` 只诊断缺失的判断能力、原因和影响，不直接确定正式本体应新增什么；它不替代 02 配对产物，也不是数据证据准备的输入。**无配套 validator。**

02 和 03 中形成的任务候选都不能写入正式领域本体。

### 2.1 填写要求（规范 + 模板，含未机器校验项）

- 每个选中状态变量须完成「路径节点—状态绑定—观测需求—evidence profile」链；`validation.checks.state_variable_chain_complete=true` 才允许进入 03（见 [`02_判断结构与本体视图规范.md`](../02_判断结构与本体视图规范.md)）。
- `research_framework.alignment_checks` 四项须为 `true`；`ontology_bindings`、`handoff_to_03`、`instance_requirements` 内部结构须完整。
- 研究逻辑 Markdown 与本体视图 YAML 语义一致。

### 2.2 机器校验（`validate_02_outputs.py`）

**已 enforce：**

- 配对文件名三元组；逻辑/视图 `task_id`、`logic_id` 互引。
- 视图顶层段存在；`judgment_units`、`path_design.main_paths`、`evidence_requirements` 字段与枚举。
- `validation.result=pass` 且 `validation.checks` **全部为 `true`**（不验证链内容是否真实完整）。
- `research_framework.alignment_checks` 全部为 `true`；最小问题树关系和失败动作枚举。
- 判断单元、路径节点、实例需求、状态变量绑定、证据需求之间的 ID 引用闭包。
- 削弱条件、阻断条件、竞争解释、`handoff_to_03`、候选结构和本体缺口基础字段。

**未 enforce（须人工或后续补校验）：**

- `instance_requirements` 内 state_bindings / observations / evidence_bindings 链的业务语义。
- 研究逻辑正文与 YAML 的完整语义一致。
- 本体缺口扫描矩阵（`02_本体缺口说明模板.md`）。

---

## 3. 03 模板

- `03_数据与证据准备模板.md` 用于说明本次需要什么、如何取得和处理，以及是否达到进入 04 的条件；正式文件命名为 `03-<核心主题>数据与证据准备-<YYYYMMDD>-<当日序号>.md`。
- `03_数据与证据快照模板/` 保存同名快照摘要 Markdown 与分层 CSV 快照（`manifest.csv` + `01_plan/` + `02_assets/` + `03_gate/` + `04_05_materials/`）。`01_plan` 承接证据需求、配方、篮子、SourceProfile 运行视图、取数通道与代理指标；`02_assets/source_snapshot.csv` 承接实际取得的 SourceDocument；`03_gate/evidence_readiness_assessments.csv` 是判断单元门禁与 04 使用上限权威表；`03_gate/gaps_and_risks.csv` 统一承接证据缺口与 05 素材缺口（`gap_type=05_material`）；`04_05_materials` 标明 05 成稿素材是否达到研报级。正式目录命名为 `03-<核心主题>数据与证据快照-<YYYYMMDD>-<当日序号>/`，其中摘要文件与目录同名。
- 两项产物使用相同主题、日期、序号和运行标识，并相互引用。03 不再生成任务本体包、质量报告或其他附加文件。

### 3.1 填写要求（规范 + 模板，含未机器校验项）

- 准入状态为 `normal_pass`、`restricted_pass`、`incomplete_pass`、`failed`。
- **低于 95% 且来源层级未耗尽时不得冻结准入**（见 [`03_数据与证据准备规范.md`](../03_数据与证据准备规范.md)）。
- 取证策略须符合 `03取证策略库/`。**无配套 validator。**
- `acquisition_log.csv`、`semantic_instances.csv`、`semantic_relations.csv` 须按规范填写运行记录与语义映射。

### 3.2 机器校验（`validate_03_outputs.py`）

**已 enforce：**

- schema `1.2.0`；prep / 快照摘要 meta 与 11 个正文小节。
- 22 个 CSV 文件存在且表头与模板一致；跨 CSV 引用完整性。
- `admission`、`allowed_04_output` / `allowed_05_output` 枚举；readiness 与 manifest 计数同步。
- 反证篮子、`counter_check_status`、低 tier 来源限制、代理指标规则等业务枚举。
- `evidence_coverage_rate` 必须等于快照计数；`normal_pass/restricted_pass` 低于 `required_coverage_rate` 时必须 `search_status=source_tiers_exhausted`；`search_status=in_progress` 不得冻结可推理准入。
- `admission=failed/incomplete_pass` 时 `allowed_04_output` 不得超过证据上限；非失败准入下 acquisition log 和语义实例不得为空。

**未 enforce（须人工或后续补校验）：**

- `source_tiers_exhausted` 的业务真实性，即来源层级是否真的已经耗尽。
- `acquisition_log.csv`、`semantic_instances.csv`、`semantic_relations.csv` 的业务内容质量。
- manifest 全部列；`restricted_pass` 下可用判断单元列表。
- 取证策略库合规；prep 正文各小节**内容**质量。

---

## 4. 04 模板

- `04_推理报告模板.md` 面向研究员，固定使用「一页摘要—核心落点—主导机制—对象分化—演进路线—改判闸门—可执行跟踪」七段正文。
- 正文使用「已确认、倾向判断、条件判断、暂不可判断」等读者标签，不展示覆盖率、准入码、路径 ID 或完整变量表。每条观点必须能回到 03 的 `evidence_readiness_assessments.csv`，且不得超过 `allowed_04_output`。证据边界与审计索引只保留摘要和定位。
- `04_推理审计模板.yaml` 面向系统复核，保存证据准入、整体系统等级、观点登记、不确定性分级、本体命中、路径结果、全部状态变量和数据逻辑。审计只引用 03 记录，不复制证据明细。
- 04 每次配对生成 `04-<核心主题>推理报告-<YYYYMMDD>-<当日序号>.md` 和 `04-<核心主题>推理审计-<YYYYMMDD>-<当日序号>.yaml`，两者使用同一任务、运行、判断时点、主题、日期和序号，并双向引用。
- 04 用 01 校准研究需求和结论边界，用 02 决定研究逻辑、本体结构和规则，用 03 决定本次可使用的事实、证据及其不足；不得把 03 的路径就绪状态直接当作推理结论。

### 4.1 填写要求（规范 + 模板，含未机器校验项）

- `path_results`、`state_variable_results` 须逐节点/逐变量记录推理结果与证据支撑。
- `judgment_unit_gate_results`、`overall_judgment`、`ontology_context`、`data_logic` 须按模板完整填写。
- `input_integrity` 六项、`report_quality_check` 须真实反映范围与证据边界。
- 正文 answer first、对象分化、改判可观察等见 `00A` §5.4。

### 4.2 机器校验（`validate_04_outputs.py`）

**已 enforce：**

- 报告/审计/03 快照三元组配对与互引；报告 9 个正文小节。
- 投资建议禁用词扫描（正文）；`claim_register` 深度校验及 03 `allowed_04_output` 上限。
- `uncertainty_register` / `change_gate_register` 对 `claim_register` 的引用闭包。
- `report_quality_check`、`compliance_check` 布尔门禁（**自报为 true**，不解析正文验证）。
- `handoff_to_05` 结构与 03 快照引用；`evidence_admission` 与 manifest 一致。
- `input_integrity` 六项必须为 true；`judgment_unit_gate_results`、`path_results`、`state_variable_results` 基础结构与 03 快照引用闭包。

**未 enforce（须人工、`validate_publish.py` 部分覆盖，或后续补校验）：**

- `overall_judgment`、`ontology_context`、`data_logic` 内部业务语义。
- 不读取 01 文件校验范围；不验证正文是否满足 answer first 等语义要求。

---

## 5. 05 模板

- 05 总规范见仓库根目录 [`05_投研表达与交付规范.md`](../05_投研表达与交付规范.md)；本目录只保留 `05A`–`05E` 五个输出原型模板和 `validate_05_outputs.py`。旧的万能模板入口已删除。
- 五个模板：`05A_事件点评模板.md`、`05B_行业动态点评模板.md`、`05C_行业周期判断模板.md`、`05D_公司业绩点评模板.md`、`05E_主题深度研究模板.md`。
- 正式文件命名为 `05-<核心主题><报告类型>-<YYYYMMDD>-<当日序号>.md`，例如 `05-霍尔木兹半导体冲击事件点评-20260708-1.md`。
- 正文写作顺序为：标题 → 一页摘要 → 核心观点 → 正文 → 文末口径说明。判断时点、数据截止日、事件名称等元信息不放在摘要前。
- 05 只输出对应原型的研报正文，不包含 YAML front matter、系统留痕、判断追溯表、质量自检或生成结论；追溯和审计由配对 04 审计与 03 快照承担。
- 05 只消费 01—04 已冻结产物，优先读取 04 审计中的 `handoff_to_05` 和 03 快照中的 `display_data_candidates.csv`、`chart_data_package.csv`、`table_material_package.csv`、`source_annotation_package.csv`、`05_material_readiness.csv`；正文只展示自然语言判断、图表数据和来源名称，不得新增未经 04 审计的判断，不得补造 03 未提供的数据。
- 05 的图表与表格输出只生成制图/制表所需数据、标题、结论、解读和限制说明，不生成正式图片，不承担排版、美化、PPT 或外发审批；对应的 claim、evidence、source 等追溯 ID 不进入 05 文件。

### 5.1 机器校验（`validate_05_outputs.py`）

**已 enforce：**

- 与 01 `delivery_archetype.primary` 及文件名报告类型一致；五原型必备章节标题。
- 单跑 `validate_05_outputs.py` 时会先执行完整 `validate_01_outputs.py`，与 `validate_publish.py` 的 01 门禁保持一致。
- 正文纯净度（无 front matter、后台 ID/token、投资建议用语）；文首不堆元信息表；标题须为判断句。
- `handoff_to_05` 结构与 03 引用；`market_common_view` / `differentiated_view` 等非空（**不校验 05 正文是否体现预期差**）。
- 行业周期原型「强弱排序」章节至少 3 行表格；按原型的图表数据密度门槛；04 须 `high_quality_pass`。
- 一页摘要 500 字上限；正文不得出现 04 `prohibited_claims` 或 `expression_rules.must_avoid` 中的禁用表达；强弱排序少于 3 个对象时必须有上游显式说明。

**未 enforce（须人工或后续补校验）：**

- 正文是否按 `section_plan` 撰写；`restricted_claims` / `prohibited_claims` 是否被遵守。
- `restricted_claims` 是否被恰当降级表达；answer first、对象分化等需要语义判断的写作质量；`00A` 第二层语义审阅。

---

## 6. 全链发布校验

- `validate_publish.py` 串联 `validate_01`—`validate_05`，并强制执行 01→05 运行顺序与跨阶段门禁。
- 自动发现模式：`python3 输出模板/validate_publish.py <运行目录>`，按文件名三元组匹配同一运行的 01—05 产物。
- 截断模式：`--through 02` 只校验到 02；上游未通过时，下游阶段标记为 `blocked`，不会继续校验。
- 正式发布：默认要求各阶段 `quality_status=high_quality_pass`，输出 `publish_status=PUBLISHABLE`；否则输出 `RETURN_REQUIRED` 和 `rework_items` 返工清单。
- 显式路径模式：可分别传入 `--requirement`、`--logic`、`--view`、`--preparation`、`--snapshot-dir`、`--report`、`--audit`、`--delivery`。

相对单阶段 validator，`validate_publish.py` **额外**读取：`return_required` / `return_stage`、03 `gaps_and_risks.csv` 返工动作、04 `input_integrity` / 准入与结论冲突、05 素材 readiness 等。仍**不**替代 `00A` 独立语义审阅。

### 6.1 退回路由（增强）

除引用链、三元组、`return_required` / `return_stage` 外，还会读取：

| 来源 | 触发 | 典型退回 |
|------|------|----------|
| 各阶段 validator 报错 | 错误信息模式匹配 | 如 04 超证据上限→03，05 图表不足→03 |
| `03` manifest / `gaps_and_risks.csv` | `return_action`、`blocks_04_output` | 按缺口说明退回 01—03 |
| `03` `admission` | `incomplete_pass` / `failed` 与 04 方向性结论冲突 | 03 或 04 |
| `04` `input_integrity` / `compliance_check` | 范围漂移、未冻结证据、新建规则 | 01 / 02 / 03 |
| `04` `report_quality_check` | `result=fail` 或布尔检查为 false | 03 或 04 |
| `05_material_readiness.csv` / `gap_type=05_material` | 素材未达研报级 | 03 |

输出除 `rework_items` 外，还提供按 `return_to` 聚合的 `rework_summary`，便于直接看到应退回哪些阶段。

---

## 7. 已知差距与补全校验的优先顺序

以下为当前**模板/规范要求但 validator 未覆盖**的高优先级项，补代码时可按此顺序推进：

1. **01**：YAML 与正文语义一致性、过宽问题的更多模式识别
2. **02**：状态绑定—观测需求—evidence profile 链的业务语义
3. **03**：来源层级耗尽、取证策略库合规、CSV 行内容质量
4. **04**：`overall_judgment` / `ontology_context` / `data_logic` 深度校验
5. **全链**：`deterministic_check_status` / `semantic_review_status` 跨阶段状态机

仓库内尚无 `tests/test_validate_*.py`；回归目前依赖对示例运行目录手工执行上述脚本。
