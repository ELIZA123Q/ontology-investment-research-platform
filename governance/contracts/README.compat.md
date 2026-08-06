# compat bridge

- mode: compat
- target_authority: governance/02_合同
- write_policy: deny_new_writes (仅桥接读取，不新增权威内容)
- migration_ref: governance/01_架构/compat_policy.yaml

说明：本目录仅用于旧入口兼容；新增内容必须写入目标权威路径。
