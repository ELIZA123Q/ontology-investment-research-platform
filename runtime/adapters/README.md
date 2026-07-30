# Runtime adapters

> **面向开发者，研究员可跳过。** 这是工作台连接数据库、模型和数据源的接口层，保证你看到的数据和调用的模型是正确的。

## 持久化
- `db/`：SQLite 表定义与仓储（`connection.ts`、`runs.ts`、`sources.ts`、`artifacts.ts`、`work_items.ts`、`action_proposals.ts`、`market_events.ts`、`meta.ts`）
- `db.ts`：本机 SQLite 连接与读写入口
- `db_migrations.ts`：库结构迁移
- `db_read_models.ts`：只读查询模型

## 模型供应商
- `model_provider.ts`：供应商解析（`deepseek` | `openai_compatible`）
- `deepseek.ts`：OpenAI-compatible 结构化生成客户端（通过 `createResearchModelClient` / `resolveModelProvider` 选择供应商）

## 证据与来源
- `mcp_evidence.ts`：Stage03 一手证据 MCP（cninfo / datayes-finoper / china-policy 等）；读 `MCP_CONFIG_PATH` 或 `~/.workbuddy/mcp.json`，失败回退 Bing/公开网页

## 本体与实例图
- `ontology.ts`：本体目录与模型加载
- `ontology_candidates.ts`：本体缺口候选队列
- `ontology_research_queries.ts`：研究侧本体查询

## 研究与体验
- `research_jobs.ts`：研究任务作业队列与持久化
- `experience_cohort.ts` / `research_experience.ts`：体验队列与追加式事件台账
- `variable_comparability.ts`：状态变量跨 run 可比性

## 导出与路径
- `publish_package.ts`：正式发布包导出
- `repo-paths.ts`：仓库路径解析

第二供应商示例：在 `.env.local` 设置 `REVIEW_MODEL_PROVIDER=openai_compatible` 与 `OPENAI_COMPAT_*`，即可让独立审阅走非 DeepSeek 模型，满足评测角色隔离的前置条件。

历史路径迁移适配器已随 Ontology 2.x 退役移除；新运行请直接使用当前仓库路径与 `run_manifest` 1.3.0。
