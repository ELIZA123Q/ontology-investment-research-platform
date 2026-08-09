# 知识图合同

这里规定「关系图长什么样」：有哪些稳定投影、端点约束，以及读图的规则。

可以把它理解成**图纸规范**，不是某一次研究画出来的那张具体图。

## 给谁看

- **研究员**：理解「领域语义图」和「研究溯源图」为什么分开
- **维护者**：改图合同、投影与 Runtime 读面

## 材料从哪来

- 图合同正文：本目录 `contracts/`（及 registry 指向的资产）
- Runtime 边界实现：[`07_runtime/src/semantic/graph-contracts.ts`](../../07_runtime/src/semantic/graph-contracts.ts)
- 索引：[`registry.yaml`](./registry.yaml)

两套图不合并成「万能图」：领域事实关系与单次研究溯源分开治理，需要时通过混合检索关联。

## 怎么用

1. 要查图结构/投影定义 → 读本目录合同。
2. 要看某次研究留下的实例数据 → 去 Runtime / Workspace 产物，不要改合同目录来「修一次结果」。
3. 正式图存在且指纹一致时，阶段材料应从**图单向投影**；不要手工双向同步阶段 JSON 与图。

## 怎么维护

- 改图纸规范只改本目录合同与 registry，并同步 Runtime `graph-contracts.ts`。
- 禁止把 UI 临时布局、单次 run 物化结果写进合同。
- 改完跑语义/项目校验与 Runtime 测试。

---

## 维护者附录（可跳过）

- **status:** migrating
- **读面策略（wave D）：** 正式图可用时 Stage02–04 从图单向投影；禁止阶段 JSON ↔ 图双向手工同步
