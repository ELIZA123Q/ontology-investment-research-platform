# 业绩更新比较边界

允许的比较对象：actual、company_guidance、internal_prior、authorized_consensus。

authorized_consensus 必须有 provider、permissionScope、asOf、vintage、metric definition、unit 与期间；否则比较状态必须为 not_authorized_or_not_vintaged，并阻断任何 beat/miss 结论。
