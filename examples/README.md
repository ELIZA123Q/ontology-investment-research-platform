# 可运行样例

这里是稳定、可装载的最小验收样例，供新使用者理解图归档和运行边界，也供自动测试使用；它们不是当前市场研究结论。

| 样例 | 主要展示 |
|---|---|
| [`memory-cycle/`](memory-cycle/) | 存储周期研究的图、预期结果与报告投影 |
| [`equipment-substitution/`](equipment-substitution/) | 半导体设备国产替代的图、预期结果与报告投影 |

每个样例包含 `research-bundle.trig`、`expected.yaml` 和 `report.md`。从根目录运行 `ir-platform --runtime-dir .runtime load-bundle examples/memory-cycle/research-bundle.trig` 可装载图；更完整的步骤见[根目录 README](../README.md)。历史真实运行单独放在 [research_outputs](../research_outputs/README.md)，不要把它们当测试基准。
