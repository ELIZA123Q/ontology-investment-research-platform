# 研究价值评测

判断研究产出在冻结证据内是否站得住，以及相对「同证据直接生成」是否真有增益。

最终交付物是 `report.md`：**给研究员看的评测报告**（白话结论 + R/U/delta 分项），不是内部记分表。

不打综合分。正式结果只看五件事：

| 符号 | 含义 | 一句话 |
|---|---|---|
| `R` | 可靠性 | 核心判断有没有证据与推理支持 |
| `U` | 有用性 | 下游能不能拿它复述、跟踪、更新 |
| `delta` | 相对增益 | 比同证据直出/摘要好多少 |
| `S` | 稳定性 | 换模型、换提示是否还稳 |
| `C` | 评测可信度 | 评测器能不能抓住已知缺陷 |

**这套东西能做什么**：发现问题、比较方案、验证流程是否有用。
**不能做什么**：用四题结果宣称「系统研究可靠率为 XX%」。

---

## 怎么读

先读这一页，再按问题打开文档：

| 想搞清 | 打开 |
|---|---|
| 评什么、不评什么 | [01_评测总纲.md](01_评测总纲.md) |
| 一个案例要准备什么 | [02_案例与数据契约.md](02_案例与数据契约.md) |
| AI 角色怎么跑 | [03_评测流程与角色协议.md](03_评测流程与角色协议.md) |
| 分数怎么算 | [04_指标口径与聚合规则.md](04_指标口径与聚合规则.md) |
| 命令、排错、发布检查 | [05_运行与验收手册.md](05_运行与验收手册.md) |

规则优先级：文档说明意图 → `runtime/*.yaml` 定义契约 → Python 执行。三者冲突时先修契约，再跑正式评测。

---

## 目录

```text
评测集/
├── README.md                 ← 你在这里
├── 01_评测总纲.md … 05_运行与验收手册.md  ← 五份规范
├── validate_eval_set.py      ← 一键校验入口
└── runtime/                  ← 可执行评测
    ├── eval_cli.py           校验 / 准备 / 运行 / 聚合 / 报告
    ├── eval_core.py          共用校验与统计
    ├── suite.yaml            四题试点与运行政策
    ├── metrics.yaml          指标口径
    ├── prompts/              角色提示词
    ├── calibration/          缺陷校准
    ├── cases/                四个试点案例
    ├── mock_*.yaml/py        本地自测适配器
    └── tests/                契约与端到端测试
```

---

## 四个试点案例

| 案例 | 分层 | 测什么 |
|---|---|---|
| RV-T01 | 正式报告 | 存储周期分产品判断 |
| RV-T02 | 正式报告 | 管制与国产替代兑现 |
| RV-T07 | 正确停止 | 冲突证据下保留争议 |
| RV-T08 | 正确停止 | 证据不足时暂不可判断 |

两层分开汇总，不做「四题总通过率」。

---

## 快速跑通（mock）

```bash
python3 评测集/validate_eval_set.py

python3 评测集/runtime/eval_cli.py prepare --run-dir /tmp/research-eval
python3 评测集/runtime/eval_cli.py run \
  --run-dir /tmp/research-eval \
  --profiles 评测集/runtime/mock_profiles.yaml
python3 评测集/runtime/eval_cli.py aggregate --run-dir /tmp/research-eval
python3 评测集/runtime/eval_cli.py report --run-dir /tmp/research-eval
```

mock 只证明框架能跑，不代表真实研究质量。正式运行需配置真实生产模型、两个评测模型、两个下游模型，见 [运行手册](05_运行与验收手册.md)。
