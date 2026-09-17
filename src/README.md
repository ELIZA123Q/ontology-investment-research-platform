# Python 实现

[`ir_platform/`](ir_platform/) 是 `pyproject.toml` 指定的安装包：

| 模块 | 职责 |
|---|---|
| `ontology/` | 本体登记与编译 |
| `rules/` | 规则登记和评估 |
| `planning/` | 任务规划及 DAG 编译 |
| `execution/` | 能力、数据源、编排和审批 |
| `runtime/` | 运行对象、图仓储、归档和追溯 |
| `adapters/` | Semantica 等外部实现的隔离层 |
| `methodology.py`、`research_design.py` | 方法登记与研究设计校验 |
| `cli.py`、`validation.py` | 命令入口与项目校验 |

业务规则和研究方法不应硬编码在 Python 文件中；它们的权威入口分别是[研究规则](../研究规则/README.md)和[研究方法](../研究方法/README.md)。
