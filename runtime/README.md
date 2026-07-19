# 本机工作台（Runtime）

本机单用户的投研实验界面：由生产模型按 01—05 编排研究，与同一冻结证据的直接生成基线对照，并由不同模型完成独立审阅。

## 启动

```bash
cd runtime
cp .env.example .env.local
# 在 .env.local 中填写 DEEPSEEK_API_KEY，并配置与生产模型不同的 DEEPSEEK_REVIEW_MODEL
npm install
npm run dev
```

打开 http://localhost:3000 。SQLite 默认写在 `instances/00_本机运行/workbench.sqlite`（不进 Git）。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

## 你需要知道的边界

- 正式支持半导体；其他领域会提示知识覆盖不足。
- 搜索结果只是线索，不会因模型返回 citation 就写成正式来源；Runtime 会抓取正文、计算正文 SHA-256 并校验逐字引用定位，失败的来源不得冒充可用证据。
- Stage04、05、同证据基线、父子差异和导出包只使用已获批 Stage03 `evidence_drafts.source_ids` 实际绑定的来源；雷达线索、检索候选和失败抓取仅保留审计。
- 运行记录是事实来源；Markdown 是可编辑展示层。
- 新建运行维护 `run_manifest` 1.3.0 摘要；既有 1.2.0 本机运行只读兼容。确认阶段产物时写入 attempt/hash。
- **包类型不要混用**：`instances/02_V3样例` 是 `semantic_fixture` 语义验收基线（`validate_v3_samples.py`，不可直接当正式发布包）；工作台导出走 `workbench_export` + `validate_workbench_package.py`；正式发布包是 `formal_pack`，走 `validate_run.py` / `validate_publish.py`。
- **方法选择与规则应用发生在此**：`runtime/` 编排 01—05、检索并绑定 `methods/` 中的方法。Runtime 确定性重算并挡门的是权威表中 `execution_surface=runtime_semantic_execution` 的规则（含判断引用完整性 `judgment_reference_integrity`）；关系端点兼容 `semantic_endpoint_compatibility` 由实例图物化时的 `validateRuntimeGraph` 执行。A01/A02/A03 门槛以 `runtime_supported_profile.yaml#executable_method_profile` 为唯一权威。
- **界面分层**：结构/证据/判断页是阶段产物视图；Object Set 页才是实例图查询与 Action 执行面。

## 操作语义能力（V1.3）

- MethodApplication：02 建候选，03 绑定证据与前置条件，04 收敛为 executed/rejected/blocked/degraded，05 只引用
- 方法注册校验：运行时解析 `method_assets.yaml`、02/03 注册表和 `judgment_method_routes.yaml`；方法 ID、版本、能力类型及判断类型路由不合法时不能确认阶段产物
- 证据三角绑定：03 确认前校验证据草稿、判断单元与 MethodApplication 相互可解析；未绑定方法的非缺口证据不能进入 04
- Object Set：`GET /api/runs/:id/object-set`，页面 `/runs/:id/object-set`
- Action：`RegisterSource` → `ExtractClaim` → `NormalizeClaim` → `AssessEvidenceForUse` → `FormHypothesis` → `FormJudgment` → `RecordReasoningTrace`
- 确认 stage_02/03/04 时物化唯一 `instance_graph`；草稿投影不再 silent 冒充权威图
- 独立审阅：确认 04 后使用 `DEEPSEEK_REVIEW_MODEL` 指定的不同模型审阅；同模型的分离调用可用于返工提示，但不能通过交付门。
- 同证据基线：确认 03 后冻结证据哈希，基线不联网、不得引用证据包外来源，在 A/B 页面盲评。盲评必须记录评价人和依据，揭示 A/B 身份后不可重评。
- 模型上下文：每阶段只携带必要上游结构化产物及 hash，不重复传输 Markdown 投影，避免“上下文越大就越可靠”的假安全感。
- 重复运行归因：相同问题与领域的后续运行自动对照上一运行，区分来源变化、方法变化、模型/Prompt/知识上下文变化和无法由这些因素解释的模型波动
- 导出校验：`POST /api/runs/:id/publish` 默认写入 `instances/00_本机运行/exports/<runId>`，也可用 `WORKBENCH_EXPORT_ROOT` 指向仓库外；导出同时经 `validate_workbench_package.py` 检查证据血缘、方法、判断、审阅、基线与盲评绑定。
- 创建运行时可绑定 V3 `semantic_fixture` 样例包，直接查询其 `business_instance_graph`（不是正式发布包）

技术子目录：`app/` 界面与接口，`engine/` 编排，`adapters/` 外部适配。研究员日常只需启动工作台或对照样例即可。
