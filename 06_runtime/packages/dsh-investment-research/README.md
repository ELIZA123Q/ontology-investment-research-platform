# DSH 投研适配层

这个包是 DeepSeek Harness 的独立、版本锁定插件。它不保存研究事实，也不直接访问 SQLite：所有案例、证据、知识锁、审批与发布均通过本地 DSH Gateway 回到 `@investment/workbench`。

模型可用的工具仅限于创建/读取案例和受来源策略约束的公开证据查询；计划确认、证据确认、判断批准、发布和正式制品修订没有模型工具，必须从研究员界面发起。

安装依赖后，设置同一个本地令牌并启动：

```sh
export VNEXT_DSH_GATEWAY_TOKEN="$(openssl rand -hex 32)"
npm --workspace @investment/dsh-investment-research run dsh:stack
```

领域服务位于 `http://127.0.0.1:3000`，DSH Web 默认为 `http://127.0.0.1:3080`。升级 DSH 时先更新此包的三个精确依赖，并运行本仓库的 DSH gateway、业绩回放与黄金案例测试。
