---
name: ontology-investment-research
description: 使用语义本体、可执行研究规则、动态DAG和可追溯证据图完成投资研究。适用于行业、公司、主题、事件、基本面、预期差和短期方向研究；需要把研究过程保存为可审计运行、草稿报告并经人工审批后发布时使用。不用于只问一个无需研究的稳定常识事实。
license: Proprietary; third-party components retain their original licenses
---

# 本体驱动投资研究

本 Skill 的目录就是完整运行基座。不要复制本体或规则到用户项目；从本文件所在目录调用脚本，并把每次研究产物写入用户当前工作区。

## 开始前

1. 将本文件所在目录记为 `SKILL_ROOT`。
2. 若 `SKILL_ROOT/.venv/bin/ir-platform` 不存在，运行 `SKILL_ROOT/scripts/bootstrap.sh`。首次安装需要网络下载锁定依赖；不得静默安装到系统 Python。
3. 新环境或仓库升级后运行 `SKILL_ROOT/scripts/doctor.sh`。失败时先修复安装或配置，不得绕过验证继续形成正式判断。

## 选择运行目标

- 只入库材料：`mode: ingest_only`。
- 更新已有证据：`mode: evidence_refresh`。
- 形成完整研究草稿：`mode: full_research`。
- 修订既有研究：`mode: research_update`，并用新计划和新实体指向旧版本，不覆盖历史。

生命周期标签只是展示分组。执行顺序、是否跳过取证、是否补证和何时停止，必须由 `研究规则/rules.yaml`、`研究能力/logics.yaml` 和当前图状态决定，不能写死成固定阶段。

## 形成任务与方法声明

在用户工作区创建 `research_outputs/<研究标识>/request.yaml` 和 `initial-state.yaml`。任务必须明确对象、问题、决策用途、时间范围和排除项。完整研究还应在 `methodology` 中声明：

- `judgment_types`：要形成的判断类型；
- `framework_refs`：真正能改变判断的框架；
- `domain`：仅在存在已登记领域目录时填写。

规划器会解析取证和推理方法依赖。未知引用必须失败；不要根据标题关键词静默套用框架。字段和命令示例见 [使用与运行协议](references/usage.md)。

## 研究与取证

针对当次任务按需读取计划中列出的 `研究方法/` 文件，不要一次加载整个方法库：

- 取证需要来源选择、口径、反证或代理指标时，读取计划给出的 `evidence_method_files`；
- 形成候选判断时，读取 `reasoning_method_files`；
- 需要产业、公司、财务或市场结构时，读取 `framework_files`；
- 语义类型、关系和指标只能从 `语义本体/` 查询，不得临时发明正式类型。

当前金融行情默认使用 `akshare_mcp` 发现和取数，不使用 Wind。若当前宿主没有启用该 MCP，使用交易所、公司公告、政府或指数公司公开网页，并明确记录数据源缺口；不得静默换回 Wind。免费数据连接器只产生候选数据；正式事实仍须回溯原始来源，并保存定位、业务时间、记录时间和口径。

把已取得的来源、主张、事实、评价、假设和候选判断写入 `runtime-context.yaml` 的节点输出，再通过动态计划运行。格式见 [运行输入协议](references/runtime-context.md)。

## 裁决与发布

- 明确区分 Fact、Inference 和 Assumption；保留冲突双方与同源关系。
- 证据不足时补证、降低 Judgment 上限或停止；不得为完成报告补造结论。
- AI 可以提出计划、候选主张、候选判断和 `DraftReport`，不能自行生成正式批准。
- 运行到 `awaiting_input: ApprovalRecord` 时，向用户交付草稿、证据缺口、判断等级和审批请求。
- 只有用户对本次审批请求明确批准后，才调用 `approve` 并恢复发布节点。旧任务的批准不得挪用到新任务。

## 默认交付

在用户工作区的 `research_outputs/<研究标识>/` 保存：

- `request.yaml`、`initial-state.yaml`：任务与起始图状态；
- `execution-plan.json`：不可变动态计划；
- `runtime-context.yaml`：节点输入和证据；
- `evidence-ledger.md`：来源、事实、推断、冲突和缺口；
- `reasoning-record.md`：假设、规则评价、反证和判断边界；
- `draft-report.md`：等待审批的报告；
- `research-bundle.trig`：可移植图归档；
- `final-report.md`：仅在本次人工审批通过后生成。

报告必须答案优先，正文按决策问题组织，不按执行节点写流水账。完成前运行项目验证、追溯目标报告，并确认历史截面不会看到后来取得的证据。

需要理解本体、规则、方法和运行层边界时，读取 [目录与权威边界](docs/repository-layout.md)；需要修改运行代码时，再读取 [动态运行架构](docs/dynamic-research-runtime.md)。
