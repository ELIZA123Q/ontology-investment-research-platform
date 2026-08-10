# 规则壳（rules）

五域治理内的「规则」分层占位：公共合同、规则权威、阈值策略、追溯主链的入口壳。
**正文合同在 [`../02_合同/`](../02_合同/README.md)**，不要在本目录另写一套。

## 给谁看

维护者；研究员通常看合同/校验的人类说明即可。

## 材料从哪来

- 权威正文：`05_control_evaluation/02_合同/`
- 本目录 [`registry.yaml`](./registry.yaml) 为契约入口/迁移壳

## 怎么用

查规则归属与阈值 → 打开合同目录中的 `rule_authority_registry.yaml` 等文件。

## 怎么维护

- status: migrating；向目标壳收敛时只改指针与 registry，不复制合同正文。
- 改规则权威后跑 `validate_rule_authority.py`。

---

## 维护者附录（可跳过）

- **不放什么：** 单次 run 事实、本体对象定义正文、UI
