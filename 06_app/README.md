# 用户可见产品面

> 还不了解本项目？先读仓库根目录 [新手导读.md](../新手导读.md)。

说明「研究员打开工作台后看到什么」。真正的页面与接口实现不在本目录，而在 [`07_runtime/app/`](../07_runtime/app/)。

## 给谁看

- **研究员**：了解界面三块区域各自干什么
- **产品/维护者**：确认可信组件边界；改 UI 去 Runtime

## 材料从哪来

- **唯一实现**：[`07_runtime/app/`](../07_runtime/app/)
- **访问地址**：`http://127.0.0.1:3000`
- 本目录只作产品面登记与说明，不保存第二套前端代码

## 怎么用

1. 按根目录 [`README.md`](../README.md) 或 [`07_runtime/README.md`](../07_runtime/README.md) 启动服务。
2. 打开 `http://127.0.0.1:3000`。
3. 主界面三块：
   - **左侧**：研究主题与长期会话
   - **中间**：与 Research Lead 的连续对话、计划与执行状态
   - **右侧**：证据矩阵、假设、判断卡、报告与审计时间线等可信制品

你不需要理解五域、阶段编号、Agent、Skill 或内部 ID。工程管理能力只出现在开发者设置，不进主导航。

## 怎么维护

- 改界面、路由、可信组件：只改 `07_runtime/app/` 与相关 Runtime 代码。
- 可信组件白名单在 `07_runtime/src/capabilities/registry.ts` 的 `TRUSTED_COMPONENTS`；Agent 只能组合预批准组件，不能生成任意 HTML/JavaScript。
- 改完在 `07_runtime/` 跑 `npm test`、`npm run typecheck`、`npm run build`。

---

## 维护者附录（可跳过）

- **status:** active
- 本目录不镜像实现；产品路由与组件登记以 Runtime 为准
