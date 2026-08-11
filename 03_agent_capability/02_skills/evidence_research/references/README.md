# evidence-research · references

本目录是 [`evidence-research`](../SKILL.md) Skill 的按需加载资源：取证方法卡、来源速查、来源路由与 OPS 手册。

回答四件事：

1. **要证明什么** — 对应哪种取证方法（A01–A09）
2. **最少要拿到什么** — 完备度最低要求
3. **优先去哪找** — 来源角色、速查与 `source_routes.yaml`
4. **完备度能到哪** — 充分 / 受限 / 观察 / 不可用

真正调用搜索或 MCP 的是 Tool；本目录只提供「找谁、先找谁、怎么核验」的程序性资源。

## 材料结构

```text
evidence_research/
├── SKILL.md
├── registry.yaml                 # 取证方法机器权威
├── references/                   # ← 你在这里
│   ├── A01–A09 …
│   ├── B00 / B01 …
│   ├── source_routes.yaml        # 来源选择策略（不是 MCP）
│   ├── OPS_*.md
│   └── domains/semiconductor/
└── templates/                    # 证据快照等模板
```

- MCP 通道连接：[`../../../04_protocols/mcp/`](../../../04_protocols/mcp/README.md)
- 证据对象语义：[`01_semantic_knowledge/01_ontology/models/evidence.yaml`](../../../../01_semantic_knowledge/01_ontology/models/evidence.yaml)

## 怎么用

1. 先读 [`../SKILL.md`](../SKILL.md) 了解程序边界。
2. 用 A01–A09 确定要证明什么。
3. 用 B00 定来源角色；用 B01 / 领域 B02 与 `source_routes.yaml` 选主源与顺序。
4. 需要真实步骤时打开 OPS；需要执行通道时查 MCP（**不要**在 B 表里绑 Tool 名）。
5. 选通道后务必核验原文并留痕。

## 九种取证方法

| 方法 | 回答的问题 | 典型场景 |
|------|-----------|---------|
| A01 事实确认 | 这件事是不是真的 | 公司公告、政策原文核验 |
| A02 状态测量 | 当前是什么状态、什么水平 | 库存量、价格、产能利用率 |
| A03 趋势判断 | 方向在往哪走、处于什么阶段 | 周期位置、增速拐点 |
| A04 机制传导 | A 怎么影响 B，某因素是不是主因 | 管制→供给缺口→价格 |
| A05 对象分化 | 谁更受益、谁更受损 | 不同环节/公司的强弱对比 |
| A06 财务测算 | 对收入、利润、现金流影响多大 | 营收弹性、毛利影响 |
| A07 市场预期 | 现有信息是否已被市场定价 | 预期差分析 |
| A08 反证 | 有没有证据削弱或推翻原判断 | 竞争解释、替代风险 |
| A09 代理指标 | 没有直接数据时用什么近似 | 先行指标、替代数据 |

详细选法见 [`../registry.yaml`](../registry.yaml)。

## 与相邻 Skill 的边界

| Skill | 负责 |
|---|---|
| [`research-design`](../../research_design/SKILL.md) | 判断什么、如何拆成判断单元与证据需求 |
| **本 Skill** | 证据够不够；不得新造判断结构或直接形成结论 |
| [`judgment-reasoning`](../../judgment_reasoning/SKILL.md) | 合格证据能支持什么结论 |

## 维护

```bash
python3 03_agent_capability/02_skills/evidence_research/validate.py
```

通道变更只改 `04_protocols/mcp/`，不在本目录复制通道表。
