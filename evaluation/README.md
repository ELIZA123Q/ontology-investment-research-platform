# 6 · 研究价值评测

判断研究产出在冻结证据内是否站得住，以及相对「同证据直接生成」是否真有增益。

最终交付是 `report.md`：给研究员看的白话结论 + R/U/delta 等分项，不是内部记分表。

| 符号 | 含义 | 一句话 |
|------|------|--------|
| R | 可靠性 | 核心判断有没有证据与推理支持 |
| U | 有用性 | 下游能不能拿它复述、跟踪、更新 |
| delta | 相对增益 | 比同证据直出/摘要好多少 |
| S | 稳定性 | 换模型、换提示是否还稳 |
| C | 评测可信度 | 评测器能不能抓住已知缺陷 |

这套东西用来发现问题、比较方案；不能用四题结果宣称「系统研究可靠率为 XX%」。

评测测量的是研究价值（R/U/delta/S/C），**不**验证本体类型覆盖、规则执行面或实例图端点；那些由 `validate_v3` / Runtime 确定性规则 / `validateRuntimeGraph` 负责。

## 目录

| 编号 | 目录 | 内容 |
|------|------|------|
| 01 | [`01_协议`](01_协议) | 评什么、案例契约、角色流程、指标、运行手册、**本体消融阶梯 P0—P3** |
| 02 | [`02_案例`](02_案例) | 试点案例（RV-T01/T02/T07/T08） |
| 03 | [`03_执行`](03_执行) | 可执行 Harness（命令入口） |
| 04 | [`04_报告`](04_报告) | 评测报告输出（默认不入库） |
| 05 | [`05_决策日志`](05_决策日志) | 里程碑结论与硬门槛（入仓） |
| 06 | [`06_第二领域压力测试`](06_第二领域压力测试) | 通用核心跨领域验证脚手架 |
| 07 | [`07_研究员体验基线`](07_研究员体验基线) | 10 题前瞻体验队列、同证据配对与分母纪律 |

## 想搞清什么 → 打开哪份

| 问题 | 打开 |
|------|------|
| 评什么、不评什么 | [01_评测总纲](01_协议/01_评测总纲.md) |
| 一个案例要准备什么 | [02_案例与数据契约](01_协议/02_案例与数据契约.md) |
| AI 角色怎么跑 | [03_评测流程与角色协议](01_协议/03_评测流程与角色协议.md) |
| 分数怎么算 | [04_指标口径与聚合规则](01_协议/04_指标口径与聚合规则.md) |
| 命令与验收 | [05_运行与验收手册](01_协议/05_运行与验收手册.md) |

## 四个试点案例

| 案例 | 分层 | 测什么 |
|------|------|--------|
| RV-T01 | 正式报告 | 存储周期分产品判断 |
| RV-T02 | 正式报告 | 管制与国产替代兑现 |
| RV-T07 | 正确停止 | 冲突证据下保留争议 |
| RV-T08 | 正确停止 | 证据不足时暂不可判断 |

两层分开汇总，不做「四题总通过率」。

## 快速跑通（mock）

```bash
python3 evaluation/03_执行/validate_eval_set.py

python3 evaluation/03_执行/eval_cli.py prepare --run-dir /tmp/research-eval
python3 evaluation/03_执行/eval_cli.py run \
  --run-dir /tmp/research-eval \
  --profiles evaluation/03_执行/mock_profiles.yaml
python3 evaluation/03_执行/eval_cli.py aggregate --run-dir /tmp/research-eval
python3 evaluation/03_执行/eval_cli.py report --run-dir /tmp/research-eval
```

mock 只证明框架能跑，不代表真实研究质量。正式配置见 [运行手册](01_协议/05_运行与验收手册.md)。

## 仅 DeepSeek（`single_vendor`）

按 [`03_执行/env.example`](03_执行/env.example) 配置 `EVAL_*` 后，可用 [`03_执行/model_profiles.yaml`](03_执行/model_profiles.yaml) 先检查外部模型链路：

```bash
python3 evaluation/03_执行/eval_cli.py prepare --run-dir /tmp/research-eval
python3 evaluation/03_执行/eval_cli.py run \
  --run-dir /tmp/research-eval \
  --profiles evaluation/03_执行/model_profiles.yaml \
  --stage all \
  --intensity pilot_light \
  --max-new-requests 2
```

当前仓库档案为生产 `deepseek-v4-flash` + 评测/下游 `deepseek-v4-pro`，运行范围是 `single_vendor_comparative`：可以形成有边界的供应商内试点结论，但完整 C 门与 `formal_full` 未通过前，仍不得把局部校准切片写成研究增益或流程增益证据。真实运行必须显式传 `--max-new-requests`。

若要做有边界的单供应商比较试点，至少要有两个冻结且互异的 `model_id`，并让生产者与评测/下游模型分离；此时范围为 `single_vendor_comparative`。它可以形成供应商内的试点证据，但仍不能代替 `formal_full` 跨模型结论。
