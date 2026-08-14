# 东微半导 2025 年业绩快报：公开、确定性业绩更新回放

这是一个真实公开公司公告驱动的确定性回放案例，不是正式研究价值评测案例。

- 公开来源：苏州东微半导体股份有限公司《2025 年度业绩快报公告》；链接、发布时间、字节数和 SHA-256 由 [`05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json`](../../fixtures/earnings-update-replay-dongwei.json) 冻结。
- 允许结论：收入增长 24.87%，但营业利润下降 8.44%，因此收入增长尚未伴随营业利润同步改善。
- 明确边界：业绩快报未经审计；只有单一发行人来源；三表无法勾稽；不得给出未经独立交叉验证的因果解释；估值必须阻断。
- 已用本地原始 PDF 复验：`rawContentHash=sha256:15b090fa01bcc3fc0ac738bd63192be4336ce15989761d52912b83ba7f5c837f`，`byteLength=93572`。完整文件指纹与未来研究员录入的可定位原文摘录哈希独立保存。

运行回放：

```bash
cd 06_runtime
npm run eval:earnings:replay
```

如已经从公开 URL 下载了原文，校验冻结来源：

```bash
npm run eval:earnings:verify-source -- --file=/绝对路径/1224987566.PDF
```

这项回放零模型 token；它证明的是确定性数值/边界执行，不证明系统相对基线的研究价值。
