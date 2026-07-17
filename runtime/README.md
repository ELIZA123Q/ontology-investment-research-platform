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
- 每个运行维护 `run_manifest` 1.2.0 摘要；确认阶段产物时写入 attempt/hash。正式发布校验仍以 `instances/01_正式样例` 为准。

## 操作语义能力（V1.3）

- Object Set：`GET /api/runs/:id/object-set`，页面 `/runs/:id/object-set`
- Action：`RegisterSource` → `ExtractClaim` → `NormalizeClaim` → `AssessEvidenceForUse` → `FormHypothesis` → `FormJudgment` → `RecordReasoningTrace`
- 确认 stage_02/03/04 时物化唯一 `instance_graph`；草稿投影不再 silent 冒充权威图
- 导出校验：`POST /api/runs/:id/publish` → `instances/00_本机运行/exports/<runId>` + `validate_run.py`
- 创建运行时可绑定正式样例包，直接查询其 `business_instance_graph`

技术子目录：`app/` 界面与接口，`engine/` 编排，`adapters/` 外部适配。研究员日常只需启动工作台或对照样例即可。
