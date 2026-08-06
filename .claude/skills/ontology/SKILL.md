---
name: ontology
description: >-
  本体目录加载、语义规则计算与本体约束校验。读取本体结构定义
  和规则配置，执行属性规则计算，构建实例图，对每个判断单元执行
  O1-O9完整性checks。
  Use when user asks to "加载本体" "本体规则" "实例图"
  "本体校验" "O1-O9" "计算属性" or mentions ontology, rule compute,
  catalog loader, instance graph.
allowed-tools: Read
---

# 本体规则与约束

## 触发条件

- Stage02：为判断单元匹配本体约束（领域、角色、属性、关系）
- Stage03：对证据草稿执行 O1-O9 完整性检查
- Stage04：约束裁决在关系网的合法位置

## 使用流程

1. 加载本体目录：读取 ONTOLOGY_MODEL_FILES 列表
2. 组装本体视图：按领域裁切，形成判断单元的视野
3. 构建实例图：加载实例→属性→关系统计
4. 执行规则计算：预计算属性，加载 .yaml 规则语义
5. 执行 O1-O9 完整性检查：
   - O1: 范围清晰（是/否属于当前 J-D 投影内）
   - O2: 属性完整（必需属性是否已定位来源）
   - O3: 属性类型约束
   - O4: 关系完整性
   - O5: 实例−类型不一致检测
   - O6: 实例−实例不一致检测
   - O7: 关联缺失检测
   - O8: 已弃用项使用检测
   - O9: 未知扩展使用检测
6. 本体约束注入到判断单元

## 核心约束

- **本体提供约束，不替代判断推理**
- 本体规则不做预测，不对事实做真值判断
- 本体投影：每个判断单元只看到相关本体视图

## 本体目录速查

| 层 | 内容 | 位置 |
|---|------|------|
| 通用域 | 通用概念、时间、因果等 | `ontology/01_通用/` |
| 金融域 | 金融工具、公司、市场等 | `ontology/02_金融域/` |
| 半导体域 | 存储、设备、代工等 | `ontology/03_半导体域/` |
| 业务专项 | 产业链关系等 | `ontology/04_业务专项/` |

## 知识库引用（不复制，直接读取）

| 需要什么 | 读取位置 |
|---------|---------|
| 本体定义（四层） | `ontology/01_通用/` `ontology/02_金融域/` `ontology/03_半导体域/` `ontology/04_业务专项/` |
| 本体规则语义 | `governance/02_合同/ontology_rule_semantics_v3.yaml` |
| 基础投影规则 | `governance/02_合同/ontology_base_projection.yaml` |
| 本体版本变更 | `governance/02_合同/ontology_version_compatibility.yaml` |
| O1-O9 规范 | `governance/03_校验/` |
| 实现代码 | `runtime/skills/ontology/` |
