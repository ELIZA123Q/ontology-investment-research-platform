# 03取证策略库

本库用于 03 数据与证据准备阶段，在正式取数前为每个核心判断单元预设证据要求，并提供有限、可复用、可审计的取证规则和推荐取证来源。

## 目录结构

```text
03取证策略库/
├── 00_取证策略库总览与调用规则.md
├── 00_strategy_registry.yaml
├── 00_quality_gates.yaml
├── 00_source_registry.yaml
├── A_取证规则/
└── B_取证来源/
```

## 使用方式

03 应按以下顺序调用：

```text
读取 02 判断单元
→ 识别 judgment_type / evidence_role
→ 预设证据要求
→ 调用 A 类取证规则
→ 查询 B 类推荐取证来源
→ 选择取数通道
→ 执行取数并留痕
→ 应用质量门槛
→ 输出 04 使用上限
```

## 设计原则

1. 先定证据要求，再取数。
2. A 类规则按金融判断类型拆分，不按行业拆分。
3. SourceProfile、SourceDocument、AcquisitionChannel、AccessScope、ArtifactType 和 ContentDomain 由通用证据域承接。
4. B 类只维护推荐优先来源、来源分层和使用边界，不是封闭白名单。
5. MCP 是获取通道，不是来源。
6. 数据质量由全局门槛、规则专项要求和取数方式留痕三层共同约束。
7. 03 输出的不是材料包，而是带使用边界的推理输入包。
