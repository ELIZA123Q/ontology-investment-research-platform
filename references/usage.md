# 使用指南

本仓库根目录就是一个完整的 Codex Skill。安装后，将 Skill 根目录记为
`$SKILL_ROOT`。运行数据默认写入调用者当前目录，而不是写回 Skill 安装目录。

## 首次安装

```bash
bash "$SKILL_ROOT/scripts/bootstrap.sh"
bash "$SKILL_ROOT/scripts/doctor.sh"
```

安装脚本只安装锁文件中固定的依赖。自检会验证 Skill 元数据、研究配置、本体编译、
动态图样例和架构边界。

## 准备研究任务

任务必须明确研究模式。可选模式为：

- `ingest_only`：只把材料变成可追溯来源对象。
- `evidence_refresh`：更新证据并形成证据评价，不强制形成判断。
- `full_research`：从任务编译动态 DAG，形成草稿并等待人工审批。
- `research_update`：基于已有图状态编译增量研究 DAG。

示例任务：

```yaml
id: request:monthly-sector-view
bundle_id: monthly-sector-view
mode: full_research
title: 未来一个月某行业的基本面与预期差研究
methodology:
  judgment_types: [trend_direction, expectation_gap]
  framework_refs: [BF-SD-01, BF-EG-01]
```

`methodology` 是显式声明，平台不会仅凭标题关键词擅自选择研究框架。规划结果会记录
实际选中的取证方法、推理方法、框架正文和数据源版本。

当前图状态决定 DAG 的形状：

```yaml
evidence_ready: false
conflict_detected: false
available_types: []
```

## 编译和运行 DAG

```bash
bash "$SKILL_ROOT/scripts/ir-platform.sh" --runtime-dir .runtime \
  plan request.yaml --state state.yaml

bash "$SKILL_ROOT/scripts/ir-platform.sh" --runtime-dir .runtime \
  run PLAN_ID BUNDLE_ID --context runtime-context.yaml
```

`runtime-context.yaml` 用于把已经取得并审阅的节点产物交给能力执行器。正式事实和正式
判断仍会经过规则门槛，不能靠填写一个布尔值绕过。完整格式见
[运行上下文](runtime-context.md)。

运行到发布节点前会返回 `awaiting_input`。找到图中的 `ApprovalRequest` 后，由人类审阅者
批准，再继续同一计划：

```bash
bash "$SKILL_ROOT/scripts/ir-platform.sh" --runtime-dir .runtime \
  approve BUNDLE_ID APPROVAL_REQUEST_ID --approver RESEARCHER_ID

bash "$SKILL_ROOT/scripts/ir-platform.sh" --runtime-dir .runtime \
  run PLAN_ID BUNDLE_ID --context runtime-context.yaml
```

没有 `approver_type: human` 的 `ApprovalRecord`，平台不会生成正式 `PublishedReport`。

## 查询、追溯与归档

```bash
bash "$SKILL_ROOT/scripts/ir-platform.sh" --runtime-dir .runtime trace OBJECT_ID
bash "$SKILL_ROOT/scripts/ir-platform.sh" --runtime-dir .runtime \
  state-at --bundle-id BUNDLE_ID --recorded-at 2026-09-10T09:00:00+08:00
bash "$SKILL_ROOT/scripts/ir-platform.sh" --runtime-dir .runtime \
  export-bundle BUNDLE_ID research-bundle.trig
```

Oxigraph 是一次运行的权威图；TriG 是可移植归档。Markdown 报告是图数据的表达投影，
不是与图并列的第二权威。

## 免费金融数据源

默认来源为登记在 `研究能力/data_sources.yaml` 中的 `akshare_mcp`。仓库内专用 Agent 已携带
对应的固定版本 MCP 配置；个人 Skill 安装需要按根 README 注册一次。平台不默认调用 Wind，
也不会把单一免费接口的原始响应直接升级为正式事实。金融数据必须保存请求参数、字段口径、
观测时间、原始定位信息与交叉验证结果。MCP 未启用时只能回退到公开一手网页并记录缺口。
