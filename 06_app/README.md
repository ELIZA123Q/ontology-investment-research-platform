# app — 用户可见产品面

- **status:** active
- **唯一实现：** `07_runtime/app/`
- **地址：** `http://127.0.0.1:3000`
- **主心智：** 研究主题 + 与 Research Lead 的连续对话 + 动态可信制品画布

研究员不需要理解五域、阶段编号、Agent、Skill、Tool 或内部 ID。工程管理能力只进入开发者设置，不进入主导航。

可信组件目录由 `07_runtime/src/capabilities/registry.ts#TRUSTED_COMPONENTS` 管理，Agent 只能组合预批准组件和结构化数据，不能生成任意 HTML/JavaScript。
