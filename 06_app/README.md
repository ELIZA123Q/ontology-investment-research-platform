# app — 用户可见产品面

- **status:** shell（权威实现仍在 `07_runtime/app/`）
- **回答什么：** UI/API 呈现与交互入口地图
- **不放什么：** 权威业务定义（只消费各域）
- **当前权威：** `07_runtime/app/`（Next.js App Router）
- **工作台地址：** http://127.0.0.1:3000

## 路由地图（真实页面，不另建四套 *-ui）

| 产品面 | 路由 | 源路径 |
|--------|------|--------|
| 首页 | `/` | `07_runtime/app/page.tsx` |
| 我的研究 | `/runs` | `07_runtime/app/runs/page.tsx` |
| 新建研究 | `/runs/new` | `07_runtime/app/runs/new/page.tsx` |
| 研究工作区 | `/runs/[id]` | `07_runtime/app/runs/[id]/page.tsx` |
| 五阶段页 | `/runs/[id]/stages/[stage]` | `07_runtime/app/runs/[id]/stages/[stage]/page.tsx` |
| 知识库 | `/knowledge` | `07_runtime/app/90_compat/knowledge/page.tsx` |
| 体验基线 | `/experience` | `07_runtime/app/experience/page.tsx` |
| 本体查询 | `/ontology` | `07_runtime/app/90_compat/ontology/page.tsx` |

## 策略

波次4只建立产品面入口声明，不搬迁 Next 工程。物理抽出根级 `06_app/` 需单独变更 tsconfig/Next 根目录，不在本波次。

上位：[`05_governance/01_架构/00_五域系统骨架.md`](../05_governance/01_架构/00_五域系统骨架.md)
