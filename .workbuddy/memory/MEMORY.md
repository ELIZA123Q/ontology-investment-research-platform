# 工作区记忆

本文件只保留仍有效的操作事实；按日工作日志不入库，已经形成结论的内容应回写对应 README、合同或决策日志。

## 03阶段金融MCP数据源
- 18 个证据通道已注册并接入 03 取证阶段：通联全系列（股票/基金/指数/宏观）、cninfo（巨潮）、htsc_research（华泰研报）、china-policy（中央政策）、caixin-news（财新）、jina-reader（网页获取）
- MCP配置在 `~/.workbuddy/mcp.json`（用户级），项目级不存储密钥
- MCP通道注册：`methods/03_取证/B03_MCP通道注册.md`
- MCP操作参考：`methods/03_取证/OPS_MCP查询快速参考.md`（QP-MCP-*编号）
- 核心原则：MCP是获取通道，不是来源生产者（B00/03规范2.5节）
- 验证：`python3 methods/03_取证/validate_03.py` ← 修改后需重新验证
- validate_03.py修改要点：B文件允许B03存在、OPS文件允许第4个、QP_PATTERN支持QP-MCP-*
- `.workbuddy/project.md` 在打开项目时自动注入MCP清单到AI上下文

## 项目运行
- 运行时（dev，默认）：`cd runtime && npm run dev:singleton` → `http://127.0.0.1:3000`（含 webpack 监听+HMR，内存占用高）
- **低内存替代（已封装）**：`npm run prod:singleton` 用 `next start` 轻量运行（无文件监听/HMR，内存显著低于 dev）。`.next` 已存在时跳过构建；代码改动后用 `npm run prod:rebuild`（= `--rebuild` 强制重建）再起。卡顿时优先用此模式而非 dev。
- 后台Worker：`npm run worker`
- Python验证使用 managed Python：`/Users/luyao/.workbuddy/binaries/python/versions/3.13.12/bin/python3`
- **卡死诊断**：`curl` 返回 HTTP 000 但 `lsof -i :3000` 仍有 LISTEN 进程 = 进程卡死（8GB 内存压力下 Node 死锁/内存耗尽）。`dev-singleton.sh` 的 SIGTERM 可能杀不掉，需手动 `for pid in $(lsof -tiTCP:3000 -sTCP:LISTEN); do kill -9 $pid; done` 后重启。预防：运行期间少开重型应用（Claude/飞书/Cursor/Chrome），频繁卡死则重启机器释放内存。

## 本体约束体系（ontology/）
- 冻结门验证：`python3 ontology/01_通用/validate_v3.py`（修改本体后必跑）
- 13条正式规则全部 `executable`，26个 test case 由 `rule_interpreter.py` 在冻结门执行
- 防漂移：`validate_rule_registry_parity()` 交叉校验 YAML 模型 ↔ `governance/02_合同/rule_authority_registry.yaml`
- 引擎：`runtime/engine/semantic_execution.ts`（1025行），`REQUIRED_RULES` 从 registry 派生（`loadBlockingSemanticRuleIds`）
- YAML驱动执行：`runtime/engine/ontology_rule_defs.ts` + `ontology/01_通用/rule_interpreter.py`（TS/Python共用谓词语义）
- 3条深投研公理：value_chain_propagation_consistency / valuation_hypothesis_level_coupling / risk_exposure_blocking_linkage
- 资本市场四类（Asset/Listing/MarketExpectation/AssetImpact）全部 status: active，graph_contract.ts 自动纳入运行图
- 半导体扩展：10个对象类型 + 21条关系类型，business_instances.yaml 4485行参数实例

## Runtime 进度/状态一致性
- `research_runs.current_stage` 由 `recomputeRunProgress(runId)`（runtime/adapters/db/runs.ts）作为单一真相源维护，依据实际 approved 的 stage_XX 产出最大编号计算；禁止在其他位置直接赋值 current_stage。
- 触发点：`approveArtifact` / `supersedeDownstream` / `supersedeOtherArtifactAttempts`（artifacts.ts），覆盖所有批准与取代入口。
- 存量漂移修复：`npm run recompute:run-progress`（runtime/scripts/recompute-run-progress.ts，纯 node:sqlite）。
