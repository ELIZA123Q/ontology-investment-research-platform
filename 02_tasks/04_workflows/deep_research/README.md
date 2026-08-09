# Deep Research 可选模板

原「01—05 深度研究」材料的归档与模板区：可供方法参考、历史回放和验收基线对照。**不会被系统自动按 01→05 顺序执行。**

## 给谁看

- **研究员**：需要旧阶段结构说明时查阅（可跳过）
- **维护者：** 保持模板与 Runtime 边界清晰

## 材料从哪来

| 子目录 | 内容 |
|---|---|
| [`stages/`](stages/README.md) | 历史阶段正文 |
| [`supporting/`](supporting/README.md) | 附录与操作细则 |
| [`templates/`](templates/README.md) | 阶段产出模板 |
| [`registry.yaml`](./registry.yaml) | 模板登记 |

现行执行权威在 Runtime 的 node-catalog / planner。

## 怎么用

1. 按主题打开 `stages/` 或 `supporting/` 中的说明，当作**参考书**。
2. 真正开题仍在工作台完成；Lead 会按任务动态选节点。
3. 评测对照时，可与 [`05_governance/14_evals/`](../../../05_governance/14_evals/README.md) 案例一起看。

## 怎么维护

- 标注并保持 `template_only`；不把本目录升格为系统骨架。
- 不放本体定义、方法库正文副本、单次研究产物。
- 与执行相关的变更只改 `07_runtime`。

---

## 维护者附录（可跳过）

- **status:** `template_only`
- 确定性 Runtime 负责节点边界，Research Lead 负责选择路径
