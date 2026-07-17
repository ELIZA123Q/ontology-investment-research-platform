# Runtime · 适配器

外部接口、模型输出、来源与持久化的转换层。不改变字段语义，也不静默补齐失败字段。

旧版运行包路径迁移：

```bash
python3 runtime/adapters/legacy_run_manifest.py <旧清单> --output <新清单>
```

映射表：[`governance/01_架构/asset_migration.yaml`](../../governance/01_架构/asset_migration.yaml)。
