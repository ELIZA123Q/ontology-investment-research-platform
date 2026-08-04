# 真实运行回归

这里保存从已验收工作台运行冻结的紧凑回归夹具。它们用于验证 Runtime、导出器与
`validate_workbench_package.py` 的合同一致性，不作为 `semantic_fixture` 或 `formal_pack`，
也不据此宣称正式研究增益。

当前夹具：

- [`01_tsmc-revenue-workbench`](01_tsmc-revenue-workbench)：公开 SEC 来源、受控事实/判断投影、独立审阅、同证据基线与 A/B 绑定。

刷新夹具时，先确认本机导出已通过工作台校验，再运行：

```bash
python3 governance/03_校验/snapshot_workbench_regression.py \
  instances/00_本机运行/exports/<run-id> \
  instances/03_回归/<fixture-name>
```
