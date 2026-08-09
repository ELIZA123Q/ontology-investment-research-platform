# Skill 登记

Skill 保存「这类事情怎样做好」的程序性知识（怎么拆问题、怎么评估证据等），**不是** Runtime 里的每一步代码。

## 给谁看

- **研究员：** 了解系统会加载哪些研究技能（通常无需改）
- **维护者：** 区分 Skill 与 Service/Tool/Policy/Verifier

## 材料从哪来

- 本目录治理登记
- **唯一可执行注册源：** `07_runtime/src/capabilities/registry.ts`

## 怎么用

1. 日常研究无需手动「点选 Skill」；Lead 按任务组合。
2. 查阅现行 5 个 Skill 名称与边界 → Runtime registry + 本目录说明。
3. 不要把 Context Builder、Source Capture、引用审计、重规划、模型客户端当成 Skill。

## 怎么维护

- 新增/修改可执行 Skill：改 Runtime registry 与对应实现，再同步本目录治理说明。
- Skill 只保存程序性知识；禁止把 Provider、Tool、Policy、Verifier 伪装成 Skill。
- 改完跑 Runtime 测试与 `audit-cutover`。

---

## 维护者附录（可跳过）

- Context Builder = Runtime Service；Source Capture = Tool；引用完整性 = Verifier；重规划 = Lead Policy
