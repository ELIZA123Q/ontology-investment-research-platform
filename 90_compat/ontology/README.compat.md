# ontology (compat)

- mode: compat
- target_authority: 01_semantic/01_ontology/
- dictionary_authority: 01_semantic/02_dictionary/
- write_policy: deny_new_writes
- migration_ref: 05_governance/01_架构/compat_policy.yaml

说明：正式本体机器 YAML 与领域扩展已迁至 `01_semantic/01_ontology/`。
词典正文在 `01_semantic/02_dictionary/`。本目录仅 compat 桥与迁移账本回放。
