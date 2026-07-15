# 研究价值代理评测体系

本目录只维护一套正式评测方案：使用 AI 评测器与可验证的侧面指标，判断研究产出在冻结证据边界内有多大概率可靠，以及它相对普通生成方式是否带来真实研究增益。

评测不回答“这篇报告总体有多少分”，也不输出综合分。正式结果由三个核心结果和两个发布护栏组成：

- `R`：研究判断可靠性；
- `U`：下游任务有用性；
- `delta`：相对问题直答、冻结证据和普通摘要的增益；
- `S`：跨模型、提示、重复运行和候选顺序的稳定性；
- `C`：评测器自身经过缺陷校准后的可信度。

## 文档结构

整个方案由 6 份 Markdown 构成。README 只负责导航，其余规则各自只有一个正式定义位置。

| 文档 | 回答的问题 | 主要内容 |
|---|---|---|
| 本 README | 从哪里开始 | 方案入口、文档地图、目录与快速运行 |
| [01_评测总纲](docs/01_评测总纲.md) | 为什么评、最终回答什么 | 目标、边界、R/U/delta/S/C 架构、试点分层、发布原则 |
| [02_案例与数据契约](docs/02_案例与数据契约.md) | 一个可评案例必须准备什么 | 公开输入、冻结证据、密封裁决、隔离、扰动、案例扩展条件 |
| [03_评测流程与角色协议](docs/03_评测流程与角色协议.md) | AI 如何完成评测 | 校准门、多角色对抗、下游任务、基线、盲评、模型和平衡规则 |
| [04_指标口径与聚合规则](docs/04_指标口径与聚合规则.md) | R/U/delta/S/C 如何计算 | 等级、公式、阈值、Wilson 区间、硬错误、报告结构 |
| [05_运行与验收手册](docs/05_运行与验收手册.md) | 如何运行、排错和正式发布 | CLI、适配器、断点续跑、目录产物、测试、正式运行检查表 |

## 机器可执行内容

人类可读规范与机器契约分开维护：

```text
评测集/
├── README.md
├── docs/                         # 五份正式方案文档
├── validate_eval_set.py          # 统一评测校验入口
└── v2/
    ├── suite.yaml                # 试点、分层与运行政策
    ├── metrics.yaml              # 指标机器契约
    ├── protocol.yaml             # JSONL 模型适配器协议
    ├── prompts/                  # 角色提示词与 A/B 等价表述
    ├── cases/                    # 四个案例及其冻结证据、密封契约、扰动
    ├── calibration/              # 十类确定性缺陷
    ├── eval_cli.py               # validate/prepare/run/aggregate/report
    ├── eval_core.py              # 校验、统计、适配器与盲化实现
    ├── mock_adapter.py           # 确定性全链测试适配器
    ├── model_profiles.example.yaml
    └── tests/
```

规则优先级：

1. 本目录五份正式方案文档定义评测意图和解释口径；
2. YAML 定义可执行案例、指标和模型协议；
3. Python 实现校验、编排和聚合；
4. 若三者不一致，必须停止正式运行并先修复契约，不得临时选择对结果更有利的解释。

## 当前四题试点

| 案例 | 分层 | 研究终点 |
|---|---|---|
| RV-T01 | `report_value` | 完整行业周期报告 |
| RV-T02 | `report_value` | 完整主题深度研究 |
| RV-T07 | `restraint` | 冲突证据下保留争议 |
| RV-T08 | `restraint` | 证据不足时暂不可判断 |

`report_value` 与 `restraint` 分开汇总。T07/T08 不会因为没有强行生成完整报告而被扣分。

## 快速运行

```bash
python3 评测集/v2/eval_cli.py validate
python3 评测集/v2/eval_cli.py prepare --run-dir /tmp/research-eval-v2
python3 评测集/v2/eval_cli.py run \
  --run-dir /tmp/research-eval-v2 \
  --profiles 评测集/v2/mock_profiles.yaml
python3 评测集/v2/eval_cli.py aggregate --run-dir /tmp/research-eval-v2
python3 评测集/v2/eval_cli.py report --run-dir /tmp/research-eval-v2
```

mock 只证明评测框架可运行，不证明研究系统质量。正式运行必须配置真实生产模型、两个独立评测模型和两个独立下游任务模型。

## 历史清理说明

旧版 16 题静态任务卡、六维评分、自评结果、盲测空骨架和错误产物空骨架已删除。删除原因是：它们依赖自评、没有冻结原文证据，且与当前 R/U/delta/S/C 口径并存会造成双重标准。

旧体系中仍有实际用途的 T07/T08 正确停止产物已经迁入各自 v2 案例目录；其余历史评分不作为基线、标签或正式证据保留。
