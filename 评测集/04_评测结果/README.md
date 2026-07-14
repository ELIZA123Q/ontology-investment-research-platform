# 评测结果

把每张任务跑完后的评分表放在这里。

命名建议：`EVAL-Txx-YYYYMMDD.yaml`

从 [`../03_评分表模板.yaml`](../03_评分表模板.yaml) 复制后填写。

注意：

1. 只对 `task_status=active` 且信息截止日已到的任务正式评测（`evaluation_status=scored`）。  
2. `planned` / 未到期：`evaluation_status=not_yet_eligible`，`overall=null`，六项为「不适用」，**不进入通过率**。  
3. 执行时只提供「任务输入」；评分时再打开「评审参考」。  
4. 总体结果仅用：`通过` / `修改后通过` / `不通过`（或 null）。  
5. **终点命中 ≠ 通过。** 填写 `independence`；`self_check` 只能当内部基线。  
6. 是否扣「缺 05」完全看该题 `evaluation_scope`；禁止事后临时决定。  
7. 通过率须分：锚定基线 / 高区分度 / 常规能力；勿与盲测混报。
