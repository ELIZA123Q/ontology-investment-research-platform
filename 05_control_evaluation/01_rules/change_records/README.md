# 实质修改沉淀记录

每项改变后续研究、治理或产品行为的修改，都必须新增一份 YAML 记录。记录不替代实际的规则、方法、本体、案例或代码；它只回答：这次修改应由谁拥有、Runtime 如何执行、怎样验证，以及以后如何追溯。

路由与字段的唯一权威是 [`../policies/change_deposition_policy.yaml`](../policies/change_deposition_policy.yaml)。纯重构可以不新增记录，但必须不改变对外行为、业务语义、数据口径、权限或评测结论，并保留自动化测试证据。
