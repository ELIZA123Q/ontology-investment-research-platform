# Runtime adapters

- `db.ts`：本机 SQLite 持久化
- `model_provider.ts`：供应商解析（`deepseek` | `openai_compatible`）
- `deepseek.ts`：OpenAI-compatible 结构化生成客户端（通过 `createResearchModelClient` / `resolveModelProvider` 选择供应商）
- `mcp_evidence.ts`：Stage03 一手证据 MCP（cninfo / datayes-finoper / china-policy）；读 `MCP_CONFIG_PATH` 或 `~/.workbuddy/mcp.json`，失败回退 Bing/公开网页
- `publish_package.ts` / `ontology.ts` / `repo-paths.ts`：导出与仓库路径

第二供应商示例：在 `.env.local` 设置 `REVIEW_MODEL_PROVIDER=openai_compatible` 与 `OPENAI_COMPAT_*`，即可让独立审阅走非 DeepSeek 模型，满足评测角色隔离的前置条件。

历史路径迁移适配器已随 Ontology 2.x 退役移除；新运行请直接使用当前仓库路径与 `run_manifest` 1.3.0。
