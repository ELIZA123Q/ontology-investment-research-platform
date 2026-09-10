# 本体驱动投资研究 Skill / Agent

这是一个可直接从 GitHub 安装的投资研究 Skill，也可以在克隆仓库后作为专用研究 Agent 使用。
它以 Semantica 0.6.8 为图运行基座，用语义本体约束研究对象、用机器规则控制证据与判断门槛，
再针对每个任务编译动态 DAG。研究流程没有固定步骤数，并且正式报告必须经过人工审批。

## 快速安装

运行环境要求：Python 3.12 和 [uv](https://docs.astral.sh/uv/)。首次安装会下载 Semantica 的
完整本地推理依赖，可能需要数分钟。

### 方式一：安装为 Codex Skill

使用 Codex 自带的 GitHub Skill Installer：

```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo ELIZA123Q/ontology-investment-research-platform \
  --path . \
  --name ontology-investment-research \
  --method download

bash ~/.codex/skills/ontology-investment-research/scripts/bootstrap.sh
```

安装当前开发分支进行体验时，在安装命令末尾增加：

```bash
--ref codex/github-installable-skill
```

重启 Codex 后，可以这样调用：

```text
使用 $ontology-investment-research 研究创新药未来一个月是否可能上涨，保存阶段结果，先给我草稿和审批请求。
```

若要在个人 Skill 中启用默认的免费金融数据 MCP，注册一次固定版本的 stdio 服务：

```bash
codex mcp add akshare_mcp -- \
  uvx --with 'mcp<2' \
  --from git+https://github.com/xiaozhozho/akshare-mcp.git@9b6a22b6d83cce2a996a5072743bb06686040ce0 \
  akshare-mcp
```

不注册仍可使用 Skill 的本体、规则、方法、公开网页取证和本地图运行能力，但不能调用
AkShare MCP 工具。

### 方式二：克隆为独立研究 Agent

```bash
git clone https://github.com/ELIZA123Q/ontology-investment-research-platform.git
cd ontology-investment-research-platform
bash scripts/bootstrap.sh
bash scripts/demo.sh
```

在 Codex 中打开仓库后，可选择 `.codex/agents/investment-research.toml` 定义的
`investment_research` Agent。该 Agent 已携带固定版本的 AkShare MCP 配置；日常命令统一通过
`bash scripts/ir-platform.sh` 调用。

## 它怎样工作

- `语义本体/` 定义稳定实体、关系、词表、指标及语义约束。
- `研究规则/` 是路由、证据准入、判断等级、阻断、审批和完成条件的机器权威。
- `研究能力/` 登记可调用 Capability、Logic 与默认金融数据源。
- `研究方法/` 保存按任务选择的取证、推理、通用框架和行业框架。
- `研究运行合同/` 定义证据、判断、计划、审批、双时态和审计对象。
- Oxigraph 保存权威运行图；Semantica Pipeline 是可替换执行适配，不承担恢复权威。

一次任务的规划过程是：

```text
ResearchRequest + 当前图状态
            ↓ 规则选择 Logic、方法登记解析显式声明
       PlanProposal
            ↓ 类型、依赖、权限、循环和审批门槛校验
   不可变 ExecutionPlan
            ↓ 执行可运行节点，并在每次输出后重评规则
证据图 → 判断 → DraftReport → 等待人工 ApprovalRecord → PublishedReport
```

已有合格证据时可以跳过采集；只需资料入库时不会生成判断；存在冲突时会插入补证节点；
证据不足时会补证、降级或停止，而不是强制走完一条固定链。

## 快速运行

仓库提供了一套不访问外部网络、停在人工审批门槛的演示：

```bash
bash scripts/doctor.sh
bash scripts/demo.sh
```

真实任务可从 [`examples/quickstart`](examples/quickstart/) 复制三个输入文件：

```bash
bash scripts/ir-platform.sh --runtime-dir .runtime \
  plan request.yaml --state initial-state.yaml

bash scripts/ir-platform.sh --runtime-dir .runtime \
  run PLAN_ID BUNDLE_ID --context runtime-context.yaml
```

运行到 `awaiting_input` 后，审阅草稿、证据缺口和判断等级。只有用户明确批准本次请求，
才执行：

```bash
bash scripts/ir-platform.sh --runtime-dir .runtime \
  approve BUNDLE_ID APPROVAL_REQUEST_ID --approver RESEARCHER_ID

bash scripts/ir-platform.sh --runtime-dir .runtime \
  run PLAN_ID BUNDLE_ID --context runtime-context.yaml
```

完整格式见 [`references/usage.md`](references/usage.md) 和
[`references/runtime-context.md`](references/runtime-context.md)。

## 默认数据源与研究边界

金融候选数据默认通过 `akshare_mcp` 取得，不使用 Wind。免费接口数据不能直接升级为正式事实；
关键结论仍需回溯交易所、公司公告、政府或指数公司的原始材料，并保存定位、口径、业务时间与
记录时间。

AI 可以提出计划、候选主张、候选判断和草稿，但不能自行批准正式事实或发布正式报告。
每个报告观点都应能反向追溯到判断、规则评价、事实、主张和原始来源。

## 清晰的仓库结构

```text
.
├── SKILL.md                         # Skill 主指令与交付纪律
├── agents/openai.yaml               # Skill 展示与默认调用提示
├── .codex/agents/                   # 克隆仓库后可选的专用 Agent
├── scripts/                         # 安装、自检、统一 CLI 与离线演示
├── references/                      # 使用协议和运行上下文格式
├── src/ir_platform/                 # 编译、规划、执行、仓储与追溯代码
├── 语义本体/                         # 稳定语义权威
├── 研究运行合同/                     # 动态运行对象合同
├── 研究规则/                         # 受限 YAML DSL 规则权威
├── 研究能力/                         # Capability、Logic、数据源和模板
├── 研究方法/                         # 取证、推理、通用与领域框架
├── examples/                        # 快速开始与可装载图样例
├── tests/                           # 离线回归与架构边界测试
├── pyproject.toml                   # Python 工程与 CLI
└── uv.lock                          # 固定依赖
```

生成的 `.runtime/`、`research_outputs/` 和 `outputs/` 已排除在 Git 分发内容之外。
目录权威说明见 [`docs/repository-layout.md`](docs/repository-layout.md)，动态运行设计见
[`docs/dynamic-research-runtime.md`](docs/dynamic-research-runtime.md)。

## 开源与许可

当前项目元数据仍标记为 proprietary，第三方组件保留各自许可证，详见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。仓库在技术上已经可以公开安装；如果要作为
开源项目发布，还需要由仓库所有者明确选择并加入 LICENSE（例如 MIT 或 Apache-2.0）。
