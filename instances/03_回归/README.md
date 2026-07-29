# 真实运行回归

这里保存两类冻结回归包：工作台紧凑导出和正式发布包。它们验证不同的包合同，
也不据此宣称正式研究增益。

当前夹具：

| 目录 | 包类型 | 验证目标 |
|------|--------|----------|
| [`01_tsmc-revenue-workbench`](01_tsmc-revenue-workbench) | `workbench_export` | 公开 SEC 来源、受控投影、独立审阅、同证据基线与 A/B 绑定 |
| [`02_memory-cycle-formal-pack`](02_memory-cycle-formal-pack) | `formal_pack` | 中文正式发布包布局、发布校验与 Stage05 金标 |

刷新 `workbench_export` 夹具时，先确认本机导出已通过工作台校验，再运行：

```bash
python3 governance/03_校验/snapshot_workbench_regression.py \
  instances/00_本机运行/exports/<run-id> \
  instances/03_回归/<fixture-name>
```
