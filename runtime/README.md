# 本机工作台（Runtime）

本机单用户的投研实验界面：按 01—05 编排研究，并与普通单次 GPT 研究做对照。

## 启动

```bash
cd runtime
cp .env.example .env.local
# 在 .env.local 中填写 OPENAI_API_KEY
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
- 搜索结果先成草稿，人工确认后才能进入判断。
- 运行记录是事实来源；Markdown 是可编辑展示层。
- 新建运行维护 `run_manifest` 1.3.0 摘要；既有 1.2.0 本机运行只读兼容。确认阶段产物时写入 attempt/hash。正式发布校验仍以 `instances/01_正式样例` 为准。
- **方法选择与规则应用发生在此**：`runtime/` 编排 01—05、检索并绑定 `methods/` 中的方法、应用约束并写入 `instances/`。推理不在本体内自动完成。

## 操作语义能力（V1.3）

- MethodApplication：02 建候选，03 绑定证据与前置条件，04 收敛为 executed/rejected/blocked/degraded，05 只引用
- 方法注册校验：运行时解析 `method_assets.yaml`、02/03 注册表和 `judgment_method_routes.yaml`；方法 ID、版本、能力类型及判断类型路由不合法时不能确认阶段产物
- 证据三角绑定：03 确认前校验证据草稿、判断单元与 MethodApplication 相互可解析；未绑定方法的非缺口证据不能进入 04
- Object Set：`GET /api/runs/:id/object-set`，页面 `/runs/:id/object-set`
- Action：`RegisterSource` → `ExtractClaim` → `NormalizeClaim` → `AssessEvidenceForUse` → `FormHypothesis` → `FormJudgment` → `RecordReasoningTrace`
- 确认 stage_02/03/04 时物化唯一 `instance_graph`；草稿投影不再 silent 冒充权威图
- 独立审阅：确认 04 后，在判断页运行独立请求，检查推理跳步、证据错配、过度结论、竞争解释遗漏和追溯缺口；问题明确退回 02/03/04
- 普通基线：同题生成不使用本体和阶段流程的单次 GPT 报告，在 A/B 页面盲评
- 重复运行归因：相同问题与领域的后续运行自动对照上一运行，区分来源变化、方法变化、模型/Prompt/知识上下文变化和无法由这些因素解释的模型波动
- 导出校验：`POST /api/runs/:id/publish` → `instances/00_本机运行/exports/<runId>` + `validate_run.py`
- 创建运行时可绑定正式样例包，直接查询其 `business_instance_graph`

技术子目录：`app/` 界面与接口，`engine/` 编排，`adapters/` 外部适配。研究员日常只需启动工作台或对照样例即可。
