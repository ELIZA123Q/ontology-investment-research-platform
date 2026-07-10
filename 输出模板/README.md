# 输出模板

01—04 的总体分工和正式产物见 [`00_项目定位与边界.md`](../00_项目定位与边界.md)。本目录只保存各类产物的结构、字段和填写说明。

各产物独立版本化。01、03 准备文档和 04 既有外壳继续兼容 `1.0.0`；02 任务本体视图和 03 跨域运行实例清单使用 `2.0.0`。版本升级不得改变已经确认的 01 用户需求。

## YAML 一览

| 文件 | 性质 | 对应本体域 | 是否是正式本体 |
|---|---|---|---|
| `02_任务本体视图模板.yaml` | 单次任务对正式本体的三域切片和执行合同 | 语义域 + 证据域 + 推理域 | 否，只引用正式本体 |
| `03_跨域运行实例清单模板.yaml` | 03 批量实例文件索引 | 语义域实例 + 证据域实例 + 冻结推理输入 | 否，是运行实例清单 |
| `04_推理域运行实例与审计模板.yaml` | 04 推理结果和留痕 | 推理域实例 | 否，是运行实例与审计 |
| `05_表达审计模板.yaml` | 报告表达检查 | 不属于本体域 | 否 |
| `通用_本体候选与缺口模板.yaml` | 向本体治理流程提交候选 | semantic / evidence / reasoning 候选 | 否，审核发布后才可能进入正式本体 |

正式本体只存在于 `一级通用本体规范/` 和各 `二级…本体规范/` 下的 `semantic.yaml`、`evidence.yaml`、`reasoning.yaml`。

正式产出文件名推荐以阶段前缀 `01-` 至 `05-` 开头，格式为 `<阶段>-<核心主题><产物类型>-<YYYYMMDD>-<当日序号>`；各阶段校验器也接受不带前缀的同名文件。模板维护文件（如 `01_投研需求说明模板.md`）保留目录内编号，不用于正式产出。

## 1. 01 模板

- `01_投研需求说明模板.md` 文首 YAML front matter 保存通过版的完整字段契约，其后为正式正文结构；文件命名规则见 `01_投研判断任务受理与整理规范.md` §8.1。
- `01_不予受理说明模板.md` 文首保存不予受理版的精简 YAML 与正文要求。
- `validate_01_outputs.py` 校验通过版投研需求说明；`validate_01_rejection.py` 校验不予受理说明（不进入全链发布流程）。
- 每次项目运行必须先与研究员完成至少三个必要确认（研究对象、事件与时间、交付方式）；`validate_01_outputs.py` 会把三问记录作为进入 02 的硬门。
- 正式文件分别命名为 `01-<核心主题>投研需求说明-<YYYYMMDD>-<当日序号>.md`；不予受理版为 `01-<核心主题>不予受理说明-<YYYYMMDD>-<当日序号>.md`。

## 2. 02 模板

- `02_研究逻辑模板.md` 正文即交付物：研究员语气写分析框架；ID 与判断单元映射只写在配对 YAML。
- `02_任务本体视图模板.yaml` 面向系统，是正式本体的任务切片和执行合同，必须同时保存 `semantic_scope`、`evidence_contract`、`reasoning_plan`，并继续保存问题树、判断单元、路径、实例和证据要求。
- 正式文件分别命名为 `02-<核心主题>研究逻辑-<YYYYMMDD>-<当日序号>.md` 和 `02-<核心主题>本体视图-<YYYYMMDD>-<当日序号>.yaml`；两者必须使用相同主题、日期和序号。缺口说明为 `02-<核心主题>本体缺口说明-<YYYYMMDD>-<当日序号>.md`。
- 两份产物必须共享任务身份和逻辑 ID，并完成双向定位；技术校验统一保存在本体视图 YAML 的 `validation` 中，不进入研究逻辑正文。
- 02 选中的每个关键变量都必须完成“传导环节—状态绑定—观测需求—evidence profile”链，并由 `state_variable_chain_complete` 控制是否允许进入 03。
- `通用_本体候选与缺口模板.yaml` 可由 02、03、04 使用，记录语义、证据或推理域候选；候选不得自动修改正式本体。原有缺口说明 Markdown 可继续用于研究员可读诊断。
- `validate_02_gap_note.py` 校验可选的本体缺口说明；可附带配对研究逻辑与本体视图做引用一致性检查。

02 和 03 中形成的任务候选都不能写入正式领域本体。

## 3. 03 模板

- `03_数据与证据准备模板.md` 正文说明证据把握与局限；门槛明细与 ID 映射只写在快照 CSV。
- `03_跨域运行实例清单模板.yaml` 按 `semantic_domain`、`evidence_domain`、`reasoning_domain` 分组保存正式本体版本、02 视图版本与哈希、实例文件索引和跨域约束。
- `03_数据与证据快照模板/` 在原有运行表之外增加 `source_documents.csv`、`evidence_claims.csv`、`evidence_facts.csv`、`evidence_relations.csv`、`evidence_assessments.csv`，形成 SourceDocument→EvidenceClaim→EvidenceFact 及 EvidenceAssessment 的规范化证据链；`evidence_records.csv` 暂作为兼容投影保留。
- 正式文件命名为 `<核心主题>数据与证据准备-<YYYYMMDD>-<当日序号>.md` 和 `<核心主题>数据与证据快照-<YYYYMMDD>-<当日序号>/`；校验器也接受可选的 `03-` 阶段前缀。
- 03 准入状态为 `normal_pass`、`restricted_pass`、`incomplete_pass`、`failed`；低于 95% 且来源层级未耗尽时不得冻结准入。
- `04_05_materials/` 等子目录用于 05 材料包，不替代根目录 CSV 契约。

## 4. 04 模板

- `04_推理报告模板.md` 面向研究员：§1—§6 为业务正文；§7 判断依据与局限；§8 质量门槛检查。
- `04_推理域运行实例与审计模板.yaml` 同时是推理域运行实例文件；除原有审计字段外，必须保存 `hypotheses`、`signals`、`rule_evaluations`、`judgments`、`reasoning_traces`。
- 正式文件命名为 `<核心主题>推理报告-<YYYYMMDD>-<当日序号>.md` 和 `<核心主题>推理审计-<YYYYMMDD>-<当日序号>.yaml`；校验器也接受可选的 `04-` 阶段前缀。
- `validate_04_outputs.py` 检查报告/审计/03 快照配对、观点未越 03 上限、正文禁用词和审计质量检查。

## 5. 05 研究员交付

- `05_主题深度研究模板.md` 固定首页（投资要点、核心结论概览）与尾部（投资含义、催化验证与风险、资料来源），正文按 2—5 个核心论点弹性组织；规范见 [`05_研究员交付规范.md`](../05_研究员交付规范.md)。
- 文首元信息统一使用「判断时点、前瞻窗口、研究对象、研究范围」；「未来重点观察」承接 04 跟踪项语义，表头可按 IM 阅读需要调整。
- 正式文件命名为 `05-<核心主题>主题深度研究-<YYYYMMDD>-<当日序号>.md`；校验器也接受不带 `05-` 前缀的同名文件。
- `validate_05_outputs.py` 校验文件名、文首字段、首页/尾部功能节、核心论点章节数量（2—5）、合规声明与正文禁用词；`validate_05_materials.py` 在 03 快照内检查 `04_05_materials/05_material_readiness.csv`。
- `validate_publish.py` 在运行目录存在 05 产物且 04 通过后追加 05 检查；拟 `high_quality_pass` 发布时还要求快照内 `05_material_readiness.csv` 全部 `report_grade_ready`。

## 6. 全链发布校验

- `validate_publish.py` 对同一运行目录编排 `validate_01`—`validate_05`，并做跨阶段一致性检查（三元组、`task_id`、`execution_id`、发布质量门槛）。
- 默认 `--through 05`；仅发布到中间阶段时使用 `--through 01|02|03|04`。运行目录存在 05 产物时，即使 `--through 04` 也会校验 05 并纳入 `PUBLISHABLE` 判定。
- `--allow-minimum` 允许各阶段 `quality_status=minimum_pass`；默认要求 `high_quality_pass`。
- 输出 `publish_status`（`PUBLISHABLE` / `RETURN_REQUIRED`）、`return_stage` 与 `return_plan`；路由规则见 `return_routing.py`。
- 用法示例：`python3 输出模板/validate_publish.py 示例2` 或 `python3 输出模板/validate_publish.py 示例2 --through 04`。

## 7. 校验器总览

| 脚本 | 作用域 | 纳入 `validate_publish` | 说明 |
|------|--------|-------------------------|------|
| `validate_01_outputs.py` | 01 投研需求说明 | 是 | 三问硬门、YAML/正文章节、`quality_gate_ref` |
| `validate_01_rejection.py` | 01 不予受理说明 | 否 | 超范围任务的独立出口 |
| `validate_02_outputs.py` | 02 研究逻辑 + 本体视图 | 是 | 配对一致性、问题树/路径/证据链 |
| `validate_02_gap_note.py` | 02 本体缺口说明（可选） | 否 | 不阻断主链；维护者复核用 |
| `validate_03_outputs.py` | 03 准备 + 跨域运行实例清单 + 快照 | 是 | 校验语义实例、来源—主张—事实链、证据评价和冻结推理输入 |
| `validate_04_outputs.py` | 04 报告 + 推理实例审计 + 03 快照 | 是 | 校验 02 规则、03 输入和假设—信号—规则评价—判断—留痕链 |
| `validate_05_outputs.py` | 05 研究员交付 | 是（有 05 产物时） | 无 YAML；首页/尾部功能节、论点章数量、合规声明 |
| `validate_05_materials.py` | 03 快照内成稿素材 | 间接（经 03；发布时 05 存在则再检） | 可单独运行 |
| `validate_publish.py` | 全链 01—05 | — | 三元组、`task_id`/`execution_id`、发布门槛 |
| `return_routing.py` | 返工路由 | — | 被 `validate_publish` 调用，非 CLI |
| `quality_gate_utils.py` / `validator_utils.py` | 共享库 | — | 准入码、门禁字段、文件名解析 |

**仓库内另有基础设施校验（不纳入投研产出全链）：**

| 脚本 | 作用域 |
|------|--------|
| `一级通用本体规范/validate_schema.py` | 一级本体 schema 与仓库路径引用 |
| `02框架库/validate_frameworks.py` | 框架库 front matter、章节、本体 ID 引用 |
