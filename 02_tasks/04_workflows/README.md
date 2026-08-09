# 工作流模板

这里放**可选**的研究工作流模板与历史方法参考。现行系统由 Research Lead 在 Runtime 里动态规划路径，**不会**自动按「01→05」固定流水线执行。

## 给谁看

- **研究员**：需要对照旧阶段文档或模板时查阅
- **维护者**：模板治理；禁止把本目录恢复成总控制器

## 材料从哪来

| 内容 | 位置 |
|---|---|
| Deep Research 可选模板（原 01—05） | [`deep_research/`](deep_research/README.md) |
| 阶段正文 | `deep_research/stages/` |
| 附录与操作细则 | `deep_research/supporting/` |
| 阶段产出模板 | `deep_research/templates/` |

方法正文（框架/取证/裁决/表达）在 [`03_capabilities/05_method_libraries/`](../../03_capabilities/05_method_libraries/README.md)，不在本目录重复维护。

## 怎么用

1. 正常做研究 → 直接用工作台；不必先读完 Deep Research。
2. 需要历史阶段结构或模板措辞 → 打开 `deep_research/` 对应文件当参考。
3. 记住：模板 ≠ 现行状态机。

## 怎么维护

- 只维护模板与历史基线；执行逻辑改 `07_runtime`。
- 禁止恢复固定 01→05 controller。
- 模板变更时更新各子目录 README 与 registry，并注明 `template_only`。

---

## 维护者附录（可跳过）

- 执行权威：`07_runtime/src/runtime/node-catalog.ts`、`planner.ts`
- Deep Research status：`template_only`
