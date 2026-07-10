# 输出模板

01—04 的总体分工和正式产物见 [`00_项目定位与边界.md`](../00_项目定位与边界.md)。本目录只保存各类产物的结构、字段和填写说明。

当前 01—04 输出模板版本统一为 `1.0.0`。

正式产出文件名推荐以阶段前缀 `01-` 至 `05-` 开头，格式为 `<阶段>-<核心主题><产物类型>-<YYYYMMDD>-<当日序号>`；各阶段校验器也接受不带前缀的同名文件。模板维护文件（如 `01_投研需求说明模板.md`）保留目录内编号，不用于正式产出。

## 1. 01 模板

- `01_投研需求说明模板.md` 文首 YAML front matter 保存通过版的完整字段契约，其后为正式正文结构；文件命名规则见 `01_投研判断任务受理与整理规范.md` §8.1。
- `01_不予受理说明模板.md` 文首保存不予受理版的精简 YAML 与正文要求。
- `validate_01_outputs.py` 校验通过版投研需求说明；`validate_01_rejection.py` 校验不予受理说明（不进入全链发布流程）。
- 每次项目运行必须先与研究员完成至少三个必要确认（研究对象、事件与时间、交付方式）；`validate_01_outputs.py` 会把三问记录作为进入 02 的硬门。
- 正式文件分别命名为 `01-<核心主题>投研需求说明-<YYYYMMDD>-<当日序号>.md`；不予受理版为 `01-<核心主题>不予受理说明-<YYYYMMDD>-<当日序号>.md`。

## 2. 02 模板

- `02_研究逻辑模板.md` 面向研究员，保存 7 章正文结构与 front matter 字段契约；重点解释问题拆解、关键核心问题、主路径、反面证据和其他可能解释。它不是 YAML 的文字版。
- `02_判断结构与本体视图模板.yaml` 面向系统，保存 `task_context`、`quality_control`、`research_framework`、`judgment_units`、`path_design`、`ontology_bindings`、`instance_requirements`、`evidence_requirements`、`handoff_to_03` 和 `validation`。
- 正式文件分别命名为 `02-<核心主题>研究逻辑-<YYYYMMDD>-<当日序号>.md` 和 `02-<核心主题>本体视图-<YYYYMMDD>-<当日序号>.yaml`；两者必须使用相同主题、日期和序号。缺口说明为 `02-<核心主题>本体缺口说明-<YYYYMMDD>-<当日序号>.md`。
- 两份产物必须共享任务身份和逻辑 ID，并完成双向定位；技术校验统一保存在本体视图 YAML 的 `validation` 中，不进入研究逻辑正文。
- 02 选中的每个关键变量都必须完成“传导环节—状态绑定—观测需求—evidence profile”链，并由 `state_variable_chain_complete` 控制是否允许进入 03。
- `02_本体缺口说明模板.md` 只诊断缺失的判断能力、原因和影响，不直接确定正式本体应新增什么；它不替代 02 配对产物，也不是数据证据准备的输入。
- `validate_02_gap_note.py` 校验可选的本体缺口说明；可附带配对研究逻辑与本体视图做引用一致性检查。

02 和 03 中形成的任务候选都不能写入正式领域本体。

## 3. 03 模板

- `03_数据与证据准备模板.md` 保存准备文档 front matter 与 10 章正文结构；重点说明 02 交接基线、核心问题证据门槛、覆盖与路径就绪状态、准入结论。
- `03_数据与证据快照模板/` 保存同名快照摘要 Markdown 和根目录 11 张 CSV；`judgment_unit_readiness.csv` 以核心问题承接证据门槛和 `allowed_04_output`。
- 正式文件命名为 `<核心主题>数据与证据准备-<YYYYMMDD>-<当日序号>.md` 和 `<核心主题>数据与证据快照-<YYYYMMDD>-<当日序号>/`；校验器也接受可选的 `03-` 阶段前缀。
- 03 准入状态为 `normal_pass`、`restricted_pass`、`incomplete_pass`、`failed`；低于 95% 且来源层级未耗尽时不得冻结准入。
- `04_05_materials/` 等子目录用于 05 材料包，不替代根目录 CSV 契约。

## 4. 04 模板

- `04_推理报告模板.md` 面向研究员：§1—§6 为业务正文（一页摘要、核心判断、核心逻辑、细分赛道与公司差异、行业所处阶段、关键跟踪指标）；§7 判断依据与局限；§8 04 质量门槛检查。
- `04_推理审计模板.yaml` 面向系统复核，保存 `metadata`、`evidence_admission`、`judgment_unit_gate_results`、`claim_register`、`change_gate_register`、`report_quality_check` 等机器字段。
- 正式文件命名为 `<核心主题>推理报告-<YYYYMMDD>-<当日序号>.md` 和 `<核心主题>推理审计-<YYYYMMDD>-<当日序号>.yaml`；校验器也接受可选的 `04-` 阶段前缀。
- `validate_04_outputs.py` 检查报告/审计/03 快照配对、观点未越 03 上限、正文禁用词和审计质量检查。

## 5. 05 研究员交付

- `05_主题深度研究模板.md` 保存主题深度研究的正文结构与文首元信息；第七章「关键跟踪指标」与 04 §6 表头一致；规范见 [`05_研究员交付规范.md`](../05_研究员交付规范.md)。
- 正式文件命名为 `05-<核心主题>主题深度研究-<YYYYMMDD>-<当日序号>.md`；校验器也接受不带 `05-` 前缀的同名文件。
- `validate_05_outputs.py` 校验文件名、正文章节、合规声明与正文禁用词；`validate_05_materials.py` 在 03 快照内检查 `04_05_materials/05_material_readiness.csv`。
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
| `validate_03_outputs.py` | 03 准备 + 快照 | 是 | 含 11 张 CSV；内部调用 `validate_05_materials` |
| `validate_04_outputs.py` | 04 报告 + 审计 + 03 快照 | 是 | 观点强度上限、§1—§6 禁用词 |
| `validate_05_outputs.py` | 05 研究员交付 | 是（有 05 产物时） | 无 YAML；章节与合规声明 |
| `validate_05_materials.py` | 03 快照内成稿素材 | 间接（经 03；发布时 05 存在则再检） | 可单独运行 |
| `validate_publish.py` | 全链 01—05 | — | 三元组、`task_id`/`execution_id`、发布门槛 |
| `return_routing.py` | 返工路由 | — | 被 `validate_publish` 调用，非 CLI |
| `quality_gate_utils.py` / `validator_utils.py` | 共享库 | — | 准入码、门禁字段、文件名解析 |

**仓库内另有基础设施校验（不纳入投研产出全链）：**

| 脚本 | 作用域 |
|------|--------|
| `一级通用本体规范/validate_schema.py` | 一级本体 schema 与仓库路径引用 |
| `02框架库/validate_frameworks.py` | 框架库 front matter、章节、本体 ID 引用 |
