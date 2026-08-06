# compat bridge

- mode: compat
- target_authority: 02_tasks/04_workflows/deep_research (compat mirror)
- write_policy: deny_new_writes (仅桥接读取，不新增权威内容)
- migration_ref: 05_governance/01_架构/compat_policy.yaml

说明：本目录仅用于旧入口兼容；新增内容必须写入目标权威路径。
