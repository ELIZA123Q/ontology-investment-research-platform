# 真实运行回归

这里保存从已验收工作台运行冻结的紧凑回归夹具，用来验证 Runtime、导出器与校验脚本是否仍然一致。
它们**不是**正式研究增益证明，也不是现行方法规范。

## 给谁看

维护者 / 做回归的工程师；研究员偶尔可当阅读样例。

## 材料从哪来

- 来源：本机已通过校验的工作台导出
- 当前夹具：
  - [`01_tsmc-revenue-workbench`](01_tsmc-revenue-workbench/README.md)
  - [`02_memory-cycle-formal-pack`](02_memory-cycle-formal-pack/README.md)

## 怎么用

1. 阅读某夹具 README，按其中说明理解「冻结了什么」。
2. 跑项目校验/夹具校验以确认合同未漂。
3. 不要把夹具结论当成最新投研观点。

## 怎么维护

刷新夹具前，先确认本机导出已通过工作台校验，再运行：

```bash
python3 05_control_evaluation/03_校验/snapshot_workbench_regression.py \
  04_context_state/03_workspace/00_本机运行/exports/<run-id> \
  04_context_state/03_workspace/03_回归/<fixture-name>
```

---

## 维护者附录（可跳过）

- 不作为 `semantic_fixture` 或（除非夹具自己标明）`formal_pack` 的研究增益宣称依据
