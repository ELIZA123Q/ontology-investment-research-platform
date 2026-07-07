# 05-工程交付与 Bundle 契约

本文是 Bundle、workbench、workspace、scenario pack 和 runtime contracts 的工程契约说明。项目目录总边界以根目录 `PROJECT_ARCHITECTURE.md` 为准；任务执行链路以 `PIPELINE.md` 为准；本文只展开 Bundle 相关的目录、manifest、registry、runtime package、校验和加载契约。

工程交付与 Bundle 契约回答四件事:资产放在哪里、怎么发布、怎么校验、怎么加载。它不替代治理闭环;所有写入、晋升、补丁和发布门禁以 `04_治理域规范` 为准。

本文主要给生产型任务能力、Bundle 生成器、校验器和工程实现者读取。运行端 / 消费型任务能力默认读取 `bundle_summary.yaml`、`capability_index.yaml`、`scenario_summary.yaml`、`loading_rules.yaml` 和治理门禁摘要;只有任务涉及生成、校验、发布、跨包引用或工程调试时,才读取完整工程契约。

本文不像前四个业务域那样拆成 objects / relations / actions；对应机器契约主要是 `policies_engineering.yaml`、`policies_validation.yaml`、`contracts_runtime.yaml`、`contracts_workspace.yaml` 和 `contracts_data_service.yaml`。正文按正式 bundle、bundle workbench、team workspace、scenario pack、registry、manifest/hash、fixtures 和分层加载组织。

---

## 1. 它产出什么

对研究员来说,工程交付决定的是:你的研究资产放在哪里、下次能不能被找到、能不能被别人按场景复用、修改后能不能被校验和发布。下面这些工程对象都是为这个目标服务。

| 产出 | 说明 |
|---|---|
| Bundle 发布单元 | 版本化、可校验、可复用的投研资产包。 |
| 目录契约 | 规定正式 bundle、bundle workbench 与 team workspace 三个独立写入面。 |
| Manifest 与 hash | 声明版本、文件清单、hash、兼容范围、发布状态和质量元数据。 |
| Schema 与校验脚本 | 通过 schema、`validate_core.py`、`validate_bundle.py`、registry check 和 inventory check 约束结构。 |
| Scenario pack | 按场景加载对象、关系、变量、证据和规则的视图,不复制正式实体。 |
| Bundle registry | 管理跨包索引、owner、版本、依赖、external_ref 和引用解析。 |
| Data product registry | 登记可供场景绑定的数据产品、访问模式、输出契约和失败行为；禁止保存凭据。 |
| Team workspace | 承接按次 `ResearchMissionContract`、`JudgmentRecord`、复盘、偏差、运行结果和 `RuntimeEvidenceSnapshot`。 |
| Fixtures 与模板 | 提供最小验收样例、判断记录与复盘流样例和生产包脚手架。 |

---

## 2. 最小工程交付闭环

工程交付的最小闭环为:

**在 bundle workbench 搜索、归一和生产候选 → 审核候选与 PatchRequest → 受治理地写入正式 owner bundle → 绑定 scenario pack 与 capability_index → 生成 runtime contracts → 分别运行 bundle、workbench、workspace 校验 → 更新 registry 与 hash → 发布。**

需求侧闭环和任务执行顺序见 `PIPELINE.md`。本文不重复说明 00/01/03/14/15/16 的完整执行流程，只说明这些任务产物在 Bundle 工程面如何落盘、校验和发布。

---

## 3. Bundle 定位与 v1 包类型

bundle 是可交付、可校验、可版本管理、可复用的行业判断框架发布单元。运行轨迹、人的判断和生产过程不属于 bundle。

v1 默认正式主包是 `industry_bundle`。它只承载已审核的 `shared/`、`scenario_packs/` 与 `runtime_contracts/`。`theme_bundle`、`event_family_bundle`、`company_asset_bundle` 保留为 advanced/future 拆包形态或外部引用形态。

若主题、事件族或公司资产具有跨行业复用价值，先在 `bundle_workbenches/<bundle_id>/staging/` 标记候选，再通过治理流程决定是否拆成独立 bundle。

---

## 4. Policies：Bundle 目录契约

三个写入面的工程口径见根目录 `PROJECT_ARCHITECTURE.md`。本文只补充 Bundle 发布和加载需要遵守的工程细则。

机器策略见 `schemas/工程交付与Bundle契约/policies_engineering.yaml.bundle_directory_contract`。三个写入面如下：

| 目录 | 定位 | 是否正式资产 |
|---|---|---|
| `industry_bundles/<bundle_id>/shared/` | 已审核、可复用、可被推理消费的正式框架资产。 | 是 |
| `industry_bundles/<bundle_id>/scenario_packs/` | 正式场景定义、引用、数据需求和输出边界。 | 是 |
| `industry_bundles/<bundle_id>/runtime_contracts/` | runtime 索引、加载配置、刷新策略和契约；禁止运行结果。 | 是 |
| `bundle_workbenches/<bundle_id>/` | research memory、候选、材料、审核、补丁和生产报告。 | 否 |
| `team_workspaces/<workspace_id>/` | 按次研究任务、JudgmentRecord、复盘、偏差、运行结果和证据快照。 | 否 |

正式 bundle、bundle workbench 与 team workspace 不得相互兼任事实源。正式 bundle 校验不得读取另外两个写入面。

任务产物按模块路由:

| 资产类型 | 主包模块 |
|---|---|
| 行业对象、公司、产品、材料、资产 | `shared/semantic_objects/` |
| 行业关系、产业链关系、资产暴露关系 | `shared/semantic_relations/` |
| 状态变量、变量观测、状态变化、派生指标 | `shared/reasoning_assets/` |
| 传导、规则、情景路径、事件模板、信号/反证模式 | `shared/reasoning_assets/` |
| 判断、市场预期、资产影响、投资命题、监控 | `shared/reasoning_assets/` |
| 已审核来源、主张、事实和证据矩阵 | `shared/evidence_index/` |
| 正式资产来源索引 | `shared/governance/asset_provenance.yaml` |
| 候选审核、补丁、实验与生产报告 | `bundle_workbenches/<bundle_id>/reviews/`、`patch_requests/`、`production_reports/` |
| 团队判断复盘 | `team_workspaces/<workspace_id>/retrospects/` |
| 按次研究任务与路由 | `team_workspaces/<workspace_id>/runs/<run_id>/research_mission.json` |
| 可复用规则、反证、场景路径、复盘发现 | `shared/reuse_assets/` |
| 未确认候选、生产审核和补丁 | `bundle_workbenches/<bundle_id>/` |

---

## 5. Policies：Scenario Pack 加载视图

`scenario_pack` 是加载视图或工作集,保存对象、关系、变量、证据和规则的引用及加载规则。它不复制正式实体,最终判断和校验以 owner bundle 中的完整资产为准。

消费型任务能力默认按需加载:

1. 先读 `scenario_summary.yaml`、`loading_rules.yaml` 和 `shared/_index/bundle_summary.yaml`。
2. 再解析 `scenario_model_ref` 或内联 `orchestration_steps`。
3. 按引用读取完整 shared 资产。
4. 执行对象、关系、证据、反证、预期、权限、时点和版本门禁。
5. 输出候选判断、观察结论、补证任务、ActionProposal 或回流反馈。

一个标准的场景包长这样（活动场景见 `industry_bundles/semiconductor_inp_bundle_v1/scenario_packs/ai_optical_inp_supply_demand_bottleneck/`）：

```text
scenario_packs/<scenario_id>/
  scenario_manifest.yaml
  scenario_summary.yaml
  loading_rules.yaml
  runtime_data_requirements.yaml
  data_bindings.yaml        # 可选；存在时必须进入 entry_files 并通过绑定校验
  object_refs.yaml
  relation_refs.yaml
  variable_refs.yaml
  evidence_refs.yaml
  rule_refs.yaml
```

标准 scenario pack 包含 `runtime_data_requirements.yaml`。它是场景级运行时查证和数据事件清单:通过 `evidence_slot_refs` 指向 `evidence_refs.yaml` 中的 evidence slot,通过 `freshness_policy_ref` 指向 `policies_governance.retrieval_policy.freshness_policy`,声明缺少当期证据时如何降级,并通过 `freshness_event_policy` 声明数据新鲜度变化应发哪些 ActionFollowup、触发哪些下游 Action。

P1a 场景可增加 `data_bindings.yaml`，把状态变量或 evidence slot 引用绑定到 `registries/data_product_registry.yaml` 中的数据产品。绑定清单只描述解析方式、值契约、新鲜度和缺失策略，不保存 endpoint 凭据，不承诺已有数据。运行前解析结果按 `data_service_resolution_contract` 进入当次运行产物；未解析绑定必须按 `on_missing` 降级或阻断。

---

## 6. Policies：Bundle Registry 与跨包引用

`bundle_registry` 是跨包索引,推荐位置是 `registries/bundle_registry.yaml`。它记录 `bundle_id`、`bundle_type`、`namespace`、owner、current_version、depends_on、status 和 exports,用于判断外部引用该去哪里解析、冲突该交给谁审核、推理运行实际消费了哪些版本。

registry 由 `scripts/generate_bundle_registry.py --write` 根据 `core_manifest.json` 和各 `00_bundle_manifest.yaml` 自动生成;`scripts/validate_core.py` 会执行 registry `--check`,因此 manifest 改动后应重新生成或校验 registry,保持单一事实源。

跨包引用遵循:

| 规则 | 含义 |
|---|---|
| 单一归属 | 每份业务资产必须声明 `owner_bundle_id`;核心规范里的 schema 类型除外。 |
| 引用归属 | 跨包使用通过 `external_ref` 引用 owner 资产。 |
| 跨包去重 | `namespace`、稳定 id 和 `normalizedKey` 共同用于跨包去重。 |
| 外部改动走补丁 | 修改外部 owner 资产时生成 PatchRequest。 |
| Owner 审核 | PatchRequest 由 owner_bundle_id 对应 owner 或 review_owner 审核。 |
| 合并有账本 | 合并、拒绝、延后、失败、回滚和迁移都必须追加 PatchLedgerItem。 |
| 外部引用可解析 | external_ref 记录 owner 版本、目标、用途、加载字段和摘要 hash。 |
| 冲突和回放可审计 | 冲突双方证据进入未解析项或审核队列;推理运行记录 bundle、版本、场景、加载资产和 as-of 时点。 |

---

## 7. Policies：Manifest、Hash 与校验脚本

核心规范使用 `core_manifest.json` 管理受管文件和 sha256 hash。业务 bundle 统一使用 `00_bundle_manifest.yaml` 管理自身版本、类型、命名空间、兼容范围、质量指标和文件清单，不保留平行 manifest 格式。

发布前至少运行:

日常修改核心 schema 或 reference 后,先跑 `validate_core.py`;修改任务型 Skill schema 快照时,再跑 `validate_task_schema_snapshots.py`;提交具体业务 bundle 前,至少跑该 bundle 的 `validate_bundle.py`;发布或整理项目结构前,再跑 inventory check。

| 校验 | 作用 |
|---|---|
| `python3 -B scripts/validate_core.py` | 校验公共核心规范,包括 manifest、schema、文档覆盖、跨域关系、旧命名残留和集成检查。 |
| `python3 -B scripts/validate_task_schema_snapshots.py` | 校验任务型 Skill 是否采用 `canonical_core_only` 策略,不在任务目录保留公共 schema 副本。 |
| `python3 -B scripts/validate_bundle.py <bundle_path>` | 只校验正式 bundle 的对象、关系、场景和 runtime contracts。 |
| `python3 -B scripts/validate_bundle_workbench.py <workbench_path>` | 校验生产工作台、候选隔离和正式资产边界。 |
| `python3 -B scripts/validate_team_workspace.py <workspace_path>` | 校验 JudgmentRecord、晋升评估和 RuntimeEvidenceSnapshot。 |
| `python3 -B scripts/report_project_inventory.py --check` | 校验项目分层、资产发布类别、运行产物和外部任务接口。 |

最小验收样例：`fixtures/minimal_bundle`（判断链）、`fixtures/minimal_industry_bundle`（行业包目录）和 `fixtures/minimal_bundle_workbench`（生产工作台）；活动生产型行业包是 `industry_bundles/semiconductor_inp_bundle_v1`。历史协作与 Runtime fixture 已冻结，不属于 v1 校验路径。

### 7.1 摘要与问题范围编写

每个 production-ready bundle 交付时,研究员和 Agent 应能先读懂「能问什么、不能问什么」。机器策略见 `policies_engineering.yaml.loading_summary_contract`;完整编写规范见 `15-本体资产生产/references/摘要与问题范围编写要求.md`。

| 层级 | 维护（YAML） | 派生（Markdown） |
|---|---|---|
| Bundle | `shared/_index/bundle_summary.yaml` → `researcher_readable_summary` | `01_bundle_summary.md`、`runtime_contracts/runtime_context_card.md` |
| Scenario | `scenario_packs/<id>/scenario_summary.yaml` → `researcher_readable_summary` | `scenario_packs/<id>/scenario_context_card.md` |

要点:

- YAML 是唯一事实源;Markdown 由 `scripts/generate_runtime_package.py` 生成,不要手改不同步。
- 必须写清 `what_you_can_ask`、`what_we_cannot_answer`、`how_to_ask` 和示例问句。
- `question_coverage` / `question_map` 与可读摘要的问法保持一致。
- 正文写给人看,避免工程术语;参考样例见半导体 bundle v5。

发布前除校验外,必须运行:

```bash
python3 -B scripts/generate_runtime_package.py industry_bundles/<bundle_id>
```

---

## 8. Policies：Team Workspace 与 JudgmentRecord 契约

机器策略见 `schemas/工程交付与Bundle契约/contracts_workspace.yaml.team_workspace_contract` 和 `judgment_record_contract`。

Team workspace 位于正式 bundle 之外，承接团队判断与运行状态：

```text
team_workspaces/<workspace_id>/
  workspace_manifest.yaml
  judgments/
    ledger.yaml
    <record_id>.yaml
  retrospects/
  bias/
  promotion_assessments/
  runs/
    <run_id>/
      research_mission.json
      factory_run_manifest.json
      production_pipeline/
  runtime_evidence_snapshots/
```

`JudgmentRecord` 不是本体对象，不参与正式 runtime 默认加载。它只用于候选生产、复盘分析、审计追踪和用户明确指定的 thesis 验证。普通问题不得自动创建长期记录。

复盘后的 `promotion_assessment` 可以是 `record_only`、`retrospect_pool` 或 `ontology_candidate`。相同 `aggregationKey` 至少出现在三个独立判断或历史案例中，或由行业 owner 明确认定为结构性缺口后，也只允许在 bundle workbench 生成候选资产或 `PatchRequest`，不得自动写入正式 bundle。

---

## 9. 模板与 Fixtures

v1 模板覆盖五类：

```text
templates/
  industry_bundle_template/
  bundle_workbench_template/
  team_workspace_template/
  scenario_pack_template/
  cross_bundle_runtime_scenario_template/
```

`industry_bundle_template` 只创建正式发布骨架；`bundle_workbench_template` 创建研究记忆、候选、审核和报告目录；`team_workspace_template` 创建判断、复盘、运行和证据快照目录。

`scenario_pack_template` 用于挂在业务 bundle 内部的行业/主题场景加载视图;`cross_bundle_runtime_scenario_template` 用于不绑定单一 `parent_bundle_id`、跨 bundle 复用的运行时工作流场景骨架。

Fixtures 用于验收最小链路:

| Fixture | 用途 |
|---|---|
| `fixtures/minimal_bundle` | 核心规范的第一验收样例。 |
| `fixtures/team_judgment_flow` | 判断记录与复盘流验收样例。 |
| `fixtures/minimal_bundle_workbench` | 最小 bundle workbench 样例。 |
| `fixtures/minimal_industry_bundle` | 最小行业包结构样例；内嵌 `scenario_packs/minimal_scenario/` 作为最小 scenario pack 验收。 |
| `fixtures/judgment_tracking_scenario` | 判断跟踪跨 bundle 场景样例。 |

---

## 10. Policies：分层加载规则

不同类型 Skill 不需要读取完整工程交付契约,应按任务目标分层加载。

消费型任务默认只读正式 bundle、状态门禁、版本摘要和当次 RuntimeEvidenceSnapshot；不读取 bundle workbench 的审核、补丁和生产记录。只有生产、发布、跨包引用或工程调试任务，才需要完整工程契约与工作台记录。

| 任务类型 | 默认读取 | 需要时再读取 |
|---|---|---|
| 团队判断记录 | 指定 JudgmentRecord、正式 Monitor 和 team workspace 规则 | 明确复盘时再读指定 workbench ReviewRecord |
| 事件影响分析 | capability_index、ScenarioModel、loading_rules、消费门禁、当次证据快照 | 明确回放时再读指定历史运行记录 |
| 证据归一与补丁 | workbench 的 PatchRequest、审核队列、未解析项、证据准入门禁 | 函数化能力、自动化流 |
| 本体优化 | workbench 的 PatchRequest、PatchLedgerItem、ReviewRecord 与正式资产来源索引 | team workspace 细节 |
| Bundle 发布 | Manifest、schema、shared、scenario_packs、runtime_contracts、registry、校验脚本 | team workspace 判断台账 |
| 生产化评测 | workbench 中的 EvalSuite、EvalRun、MetricSnapshot 与正式 LogicFunction 契约 | team workspace 与场景运行记录 |

上表的核心约束是按需加载:先读摘要和场景索引,只有任务真的需要字段细节、发布校验或跨包解析时,才进入完整目录契约。

---

## 12. Runtime Package（工作台消费入口）

生产型 bundle 可以是复杂工程仓库;发布给工作台消费的 bundle 必须是**轻、稳、可索引、可校验**的 runtime package。

### 消费链路

```
00_bundle_manifest.yaml
  → runtime_contracts/runtime_index.yaml
  → scenario_packs/<scenario_id>/scenario_runtime_index.yaml
```

工作台不再自行遍历整个 bundle 目录;只从上述链路开始,按 `required_assets` 定点加载。

### runtime_contracts/ 目录（bundle 级）

| 文件 | 作用 |
|---|---|
| `runtime_index.yaml` | 声明可运行 scenario、共享索引路径、运行规则 |
| `runtime_loading_profile.yaml` | 预加载/按需加载策略、禁止路径、token 预算 |
| `runtime_context_card.md` | 给 LLM/研究员的一屏上下文 |
| `runtime_output_contract.yaml` | bundle 级默认输出边界 |
| `runtime_validation_report.json` | 发布门禁;`validation_status=passed` 才允许运行 |

### scenario 级运行文件

| 文件 | 作用 |
|---|---|
| `scenario_runtime_index.yaml` | 问题意图、必读/可选资产、运行时约束 |
| `scenario_output_contract.yaml` | markdown 报告 + `reasoning_result.json` + `ontology_feedback.json` |
| `scenario_context_card.md` | 场景一屏上下文 |
| `scenario_validation_report.json` | 场景级校验报告 |

### 资产暴露

正式资产通过 `shared/_index/runtime_asset_registry.yaml` 登记 `confirmation_status` 与 `runtime_exposure`。准入规则:

- `active/confirmed` + `confirmation_status=confirmed` + `include_in_runtime=true` → 工作台可加载
- `candidate/draft/needs_review` → 仅 staging
- `deprecated/rejected` → 历史保留,禁止推理

证据消费视图见 `shared/evidence_index/runtime_evidence_index.yaml`。

### 发布命令

```bash
python3 scripts/generate_runtime_package.py industry_bundles/<bundle_id> --update-manifest
python3 scripts/validate_bundle.py industry_bundles/<bundle_id>
```

`release_package/` 必须包含 `runtime_contracts/`，不得包含 bundle workbench 或 team workspace。权威契约见 `schemas/工程交付与Bundle契约/contracts_runtime.yaml`。

---

## 13. 上游与下游关系

| 文档 | 交接关系 |
|---|---|
| `04-治理域规范` | 提供准入、消费门禁、ReviewRecord、ActionProposal、PatchRequest、复盘和审核边界。 |
| `06-能力暴露与运行消费规范` | 说明运行端 / 消费型任务能力如何读取 bundle、选择能力、执行门禁、输出 JudgmentRecord 和回流缺口。 |
| `01-语义结构域` | 提供正式对象、概念、边界、关系和 ObjectSet。 |
| `02-判断推理域` | 提供状态变量、假设、信号、预期、判断、资产影响和规则模板。 |
| `03-证据域` | 提供来源、主张、事实候选、冲突、新鲜度和权限标记。 |
