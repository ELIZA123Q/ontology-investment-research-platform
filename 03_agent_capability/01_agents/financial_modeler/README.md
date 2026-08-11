# Financial Modeler — 财务建模师 AI（候选）

> 上级目录：[`01_agents/`](../README.md) | 根目录：[`README.md`](../../../README.md)

负责财务建模和估值分析的候选 Agent。目前**尚未上线**——需要通过冻结 A 股案例 forward test 与盲评门槛后，由人工批准才能激活。

## 职责

- 按授权的证据切片创建 normalized_financials、financial_model 与 valuation_analysis
- 执行模型审计

## 权限边界

**不能做**：批准或写入 Judgment、评级、目标价、仓位、交易指令、最终报告发布

模型审计失败时只能输出问题和阻断状态。

## 激活条件

先通过冻结 A 股案例 forward test 与盲评门槛，进入 active 前由人工批准。
