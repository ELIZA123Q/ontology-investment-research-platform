# 本机工作台（Runtime）

本机单用户的投研实验界面：按 01—05 编排研究，与同一冻结证据的直接生成基线对照，并由不同模型或未参与生产、留下可审计声明的人类审阅者完成独立审阅。

## 启动

**唯一入口（请收藏这个）：[http://127.0.0.1:3000](http://127.0.0.1:3000)**  
不要用 `localhost:3000`，也不要改用 3001/3002——端口被占时用 `npm run dev:singleton` 清掉再启。

```bash
cd runtime
cp .env.example .env.local
# 在 .env.local 中填写 DEEPSEEK_API_KEY，并配置与生产模型不同的 DEEPSEEK_REVIEW_MODEL
npm install
npm run dev:singleton
# 另开一个终端启动可恢复的后台执行器：
npm run worker
# 浏览器打开固定入口：
npm run open
```

打开 http://127.0.0.1:3000 。SQLite 默认写在 `instances/00_本机运行/workbench.sqlite`（不进 Git）。

> 说明：仓库路径含中文时，Next 16 默认的 Turbopack 会崩溃并在浏览器显示 `Unexpected end of JSON input`。`npm run dev` 已改为 `--webpack` + 轮询监视，避免 EMFILE。请用 `http://127.0.0.1:3000` 打开（不要混用可能被系统代理劫持的 `localhost`）。同一时间只跑一个 `next dev`；重复启动会占满 3001/3002… 并拖垮文件监视。

> 模型生成：接口会持久化 `queued` job 并立刻返回 HTTP 202；`npm run worker` 独立领取任务，页面轮询 `queued/running/retrying/waiting_for_input`。Next 请求结束时也会顺手唤醒一次 worker，但可恢复执行不依赖该回调；开发和生产都应保持独立 worker 运行。

> 恢复语义：检查点位于每个阶段开始前。job 冻结上游 artifact ID/hash；worker 中断后从当前阶段起点重试，旧 worker 的 fencing token 失效，不能覆盖新结果。若上游输入已改变，任务进入 `waiting_for_input`，不会沿用旧上下文。模型内部尚未提交的 token 流不会伪装成可恢复检查点。

> 预算语义：`RESEARCH_JOB_MAX_SOURCES` 在抓取前限制单个研究任务的累计来源总数，超出的候选保留为明确缺口；`RESEARCH_JOB_MAX_TOKENS` 在阶段产物提交评审前强制校验累计 token；任务硬超时会立即撤销租约并阻止旧执行写回。美元上限只有在 `.env.local` 同时配置金额上限和输入/输出 token 单价时启用。模型调用已经发生的输入 token 无法事后撤销，因此 token/金额上限是“禁止超额产物进入评审”，不是供应商侧的实时扣费熔断。

> 若出现 `Connection error`：多半是开发服务继承了失效代理，或 DNS/VPN 异常。请在**本机普通终端**执行 `npm run dev:singleton`（脚本会清掉 HTTP(S)_PROXY），并确认浏览器与终端都能访问 `DEEPSEEK_BASE_URL`。

> 安全边界：当前 API 无多用户鉴权，`npm run dev/start` 已强制绑定 `127.0.0.1`；API Proxy 同时拒绝非回环 Host、跨站写入和 Origin 不一致请求。不要改为 `0.0.0.0` 或直接暴露到公网；远程使用前必须先增加鉴权、限流和受控出口策略。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

## 你需要知道的边界

- 正式支持半导体；其他领域会提示知识覆盖不足。
- 搜索结果只是线索，不会因模型返回 citation 就写成正式来源；Runtime 会抓取正文、计算正文 SHA-256 并校验逐字引用定位，失败的来源不得冒充可用证据。
- **证据主路径（日常）**：抓取公开 URL → 挂到判断单元并生成事实草稿 → 在证据审阅页批准。Stage03 模型生成/补证可走一手 MCP（巨潮 cninfo、通联财务、中央政策），失败回退 Bing/公开网页；Object Set Action 仍为进阶入口。
- **MCP 在工作台内怎么用**：worker 跑 Stage03 时通过 `mcp_evidence.ts` 调用已配置的 MCP（读 `MCP_CONFIG_PATH` 或 `~/.workbuddy/mcp.json`）。MCP 返回的是线索/摘录，写正式 `source_quote` 前仍须 `fetch_public_pages` 或可核验原文。B03 里尚未接入 Runtime 的通道仍可给外部 Agent 用。
- Stage04、05、同证据基线、父子差异和导出包只使用已获批 Stage03 `evidence_drafts.source_ids` 实际绑定的来源；雷达线索、检索候选和失败抓取仅保留审计。
- 运行记录是事实来源；Markdown 是可编辑展示层。
- 新建运行维护 `run_manifest` 1.3.0 摘要；既有 1.2.0 本机运行只读兼容。确认阶段产物时写入 attempt/hash。
- **包类型不要混用**：`instances/02_V3样例` 是 `semantic_fixture` 语义验收基线（`validate_v3_samples.py`，不可直接当正式发布包）；工作台导出走 `workbench_export` + `validate_workbench_package.py`；正式发布包是 `formal_pack`，走 `validate_run.py` / `validate_publish.py`。
- **方法选择与规则应用发生在此**：`runtime/` 编排 01—05、检索并绑定 `methods/` 中的方法。Runtime 3.0 对每个新判断确定性重算并挡门权威表中 9 条 `execution_surface=runtime_semantic_execution` 规则，包括状态时间、代理披露、认证阶段、产能/良率口径和判断引用完整性；关系端点兼容 `semantic_endpoint_compatibility` 由实例图物化时的 `validateRuntimeGraph` 执行。A01/A02/A03 门槛以 `runtime_supported_profile.yaml#executable_method_profile` 为唯一权威。
- **方法正文注入（生成质量）**：主生成与 Stage03 补证都会注入 `selected_method_guidance`。Stage02 优先本题路由 default 方法正文；Stage03 只喂 kb03，Stage04 只喂 kb04（含 A00）；长框架按章节摘录保留停止/边界段，短方法尽量全文。
- **界面分层**：结构/证据/判断页是阶段产物视图；Object Set 页才是实例图查询与 Action 执行面。

## 操作语义能力（V1.3）

- MethodApplication：02 必须为每个 JudgmentUnit 同时登记结构、取证、裁决三类候选；03 绑定证据并收敛取证方法，04 收敛全部方法为 executed/rejected/blocked/degraded，05 只引用
- 方法注册校验：运行时解析 `method_assets.yaml`、02/03 注册表和 `judgment_method_routes.yaml`；候选阶段即校验方法 ID、版本、能力类型及判断类型路由，不合法时模型提交与人工确认都会被拒绝
- 证据三角绑定：03 确认前校验证据草稿、判断单元与 MethodApplication 相互可解析；未绑定方法的非缺口证据不能进入 04
- Object Set：`GET /api/runs/:id/object-set`，页面 `/runs/:id/object-set`
- Action：`RegisterSource` → `ExtractClaim` → `NormalizeClaim` → `AssessEvidenceForUse` → `FormHypothesis` → `FormJudgment` → `RecordReasoningTrace`
- 确认 stage_02/03/04 时物化唯一 `instance_graph`；草稿投影不再 silent 冒充权威图
- 独立审阅：确认 04 后可使用与生产不同的审阅模型（`REVIEW_MODEL_PROVIDER` + `DEEPSEEK_REVIEW_MODEL` 或 `OPENAI_COMPAT_REVIEW_MODEL`）；也可由未参与 Stage04 生产的人类登记结构化审阅。人类路径强制冻结 Stage04 artifact/hash、审阅者标识和至少 20 字独立性/利益冲突声明，自审不能通过。相同模型的分离调用只能用于返工提示，不能通过交付门。
- **模型隔离：** 若日后有第二供应商，可用 `REVIEW_MODEL_PROVIDER=openai_compatible` 满足 `formal_full` 的五互异 `model_id` 要求；仅 DeepSeek 时可用评测 `single_vendor` 档案，但单一 `model_id` 只能做 `pipeline_only` 冒烟，至少两个互异 `model_id` 才具备供应商内比较资格。
- 同证据基线：确认 03 后冻结证据哈希，基线不联网、不得引用证据包外来源，在 A/B 页面盲评。盲评必须记录评价人和依据，揭示 A/B 身份后不可重评。
- 模型上下文：每阶段只携带必要上游结构化产物及 hash，不重复传输 Markdown 投影，避免“上下文越大就越可靠”的假安全感。
- 重复运行归因：相同问题与领域的后续运行自动对照上一运行，区分来源变化、方法变化、模型/Prompt/知识上下文变化和无法由这些因素解释的模型波动
- 导出校验：`POST /api/runs/:id/publish` 默认写入 `instances/00_本机运行/exports/<runId>`，也可用 `WORKBENCH_EXPORT_ROOT` 指向仓库外；导出同时经 `validate_workbench_package.py` 检查证据血缘、方法、判断、审阅、基线与盲评绑定。
- 研究者来源取得：`POST /api/runs/:id/sources/acquire` 会实际抓取公开 URL、核对逐字引用并冻结发布日期、定位、抓取时间、正文 hash 与可用性。成功结果只进入 Source Registry 候选池，不会直接成为 EvidenceFact 或修改 Judgment。
- 受控事实投影：证据页或 `POST /api/runs/:id/stages/03/generate` 的 `controlled_evidence_projection` 模式可把研究者明确选择的、已满足 `usable/captured/quote_verified` 的来源逐字登记为事实草稿。请求必须给出 `source_id`、`judgment_unit_ids`、`subject_ref`、`observed_at`；同一来源只能登记一次，多个判断单元合并在同一绑定中。系统重查截止时间、hash 和引用，随后仍要求对象级人工批准。
- 受控判断投影：判断页或同一阶段接口的 `controlled_judgment_projection` 模式允许研究者为每个 JudgmentUnit 填写结论、已批准事实、不确定性、竞争解释、区分性证据和改判条件，并逐项确认真正满足的方法前置条件。未显式确认的语义前置条件会使方法降级，来源抓取成功不会冒充方法适用；Runtime 再计算 Signal/Hypothesis/CompetingExplanation、J0—J4 上限和五项语义规则。
- 低成本受控确认：由研究者显式提交的 Stage 02 受控结构，确认前使用 Schema 与确定性启发式校验，不再重复调用付费模型；模型生成的结构仍保留模型确认前复核。两条路径都必须通过对象级人工批准，且受控路径不会因此绕过方法前置条件或后续本体规则。
- 体验数据库身份：`/experience` 会显示当前 SQLite 的数据范围；若连接 `/tmp` 或系统临时目录中的 QA 数据库，将明确标红并禁止把计数解释为正式前瞻样本。正式基线必须在持久工作台数据库重新登记。
- 受控表达投影：Stage04 确认后，Stage05 的 `deterministic_projection` 可直接从当前 Judgment、MethodApplication、EvidenceFact 和 Source 血缘生成**05C 骨架草稿**（含固定节与论点章），不需要先让模型写一份“种子报告”；表达只能重述获准判断，不能新增事实或抬高强度。模型生成路径会保留研报正文，`normalizeStage05Projection` **不得**再整篇压平为「研究判断简报」。
- **工作台确认 ≠ PUBLISHABLE**：Stage05 确认会跑与 `validate_05_outputs` 对齐的关键结构规则（固定节、Research Edge、2–5 论点章、禁审计腔），但正式发布包仍须通过 `governance/03_校验/validate_run.py` / `validate_05_outputs.py`。`minimum_pass` 仅表示内部可流转草稿；正式交付倾向 `high_quality_pass`。
- `task_local:<variable_id>` 表示只在当前研究任务内成立的观测变量，不会伪装为正式本体 `StateVariable`。知识库“本体缺口治理”会按规范化语义键统计跨 run 频次，记录专家确认、晋升/驳回与追加式历史；“晋升”只表示批准进入正式本体变更流程，不会自动改写本体 YAML。
- 确定性指标修复不允许改写已揭示的 A/B 评分。`POST /api/runs/:id/evaluation/recompute-metrics` 只在基线、03、04、05 的冻结 artifact/hash 完全一致时创建新评价版本，保留原评分、评价人、备注与 A/B 身份，并记录被替代评价。
- 创建运行时可绑定 V3 `semantic_fixture` 样例包，直接查询其 `business_instance_graph`（不是正式发布包）

技术子目录：`app/` 界面与接口，`engine/` 编排，`adapters/` 外部适配。研究员日常只需启动工作台或对照样例即可。
