# 语义词典

> **Dictionary = 自然研究语言 → 标准语义的归一化层。**

一句话：

> 研究员说的话先在这里弄清楚「他说的到底是什么意思」，再交给本体去认「系统正式认为什么对象 / 状态 / 关系」。

它回答的不是「世界里有什么」，而是：

```text
这个词在投研语境里通常指什么？
不同人叫法不一样怎么办？
哪些口语不能直接当成正式对象？
哪些词一开口就有歧义，必须先澄清口径？
旧名称怎么兼容，又不污染正式本体？
```

---

## 1. 它在 01_semantic_knowledge 里的位置

语义域四层分工：

```text
01_semantic_knowledge/
├── 01_ontology/         系统正式认什么
│                        Object / State / Evidence / Judgment / Relation
│
├── 02_dictionary/       人的话是什么意思
│                        Term / Alias / Ambiguity / Research Concept
│
├── 03_knowledge_graph/  对象与关系如何组织成图视图
│                        Domain Semantic Graph / Research Provenance Graph
│                        （图纸规范；单次实例写图归 Runtime）
```

信息流：

```text
研究员说的话
    ↓
02_dictionary
「他说的到底是什么意思？」
    ↓
01_ontology
「系统正式认为什么对象 / 状态 / 关系 / 证据？」
    ↓
03_knowledge_graph
「实例怎么连、provenance 图怎么投影」
```

例子：

> 「HBM 现在是不是还很紧？」

Dictionary 先处理：

```text
HBM
→ 默认按 Product 理解（必要时再讨论 Technology）

「很紧」
→ 不是正式 StateVariable
→ 可能表示：
   supply_demand_tightness
   lead_time
   inventory
   utilization
   price_trend
```

然后才交给 ontology 认正式对象，再进入取证与判断。

很多 AI 投研错误，根本不是推理错了，而是：

> **词没定义清楚，就开始搜证据。**

Dictionary 要挡住的，正是这一步。

---

## 2. 为什么必须有这一层

Ontology 负责稳定、可校验的正式世界：

- 有稳定 ID
- 有类型、关系、基数、约束
- 机器以 YAML 为准

但研究员日常说的不是这套语言。他们说：

```text
景气度
供需紧张
国产替代
订单能见度
业绩确定性
涨价
产能释放
先进制程
估值消化
预期差
卡脖子
HBM 很紧
```

这些词非常重要，却常常：

1. **不是**一个可直接建出来的 ontology Object  
2. **混了**锚定对象和可验证变量  
3. **一词多义**，口径不清就会取错证、判错案

如果没有 dictionary：

- 要么硬把「国产替代」做成 ontology 对象（污染正式模型）
- 要么让 Runtime / Agent 自由猜测（不可复现）
- 要么在 README 里零散写「Segment 已废弃」（无法归一）

所以 dictionary 的真正价值是：

> **把模糊研究语言，转成可验证研究语义。**

---

## 3. 两个权威，绝不能混

| 权威 | 谁拥有 | 回答什么 |
|---|---|---|
| **Lexical / Normalization** | Dictionary | 人说的话怎么映射 |
| **Semantic** | Ontology | 系统正式认什么 |

Runtime 消费顺序必须是：

```text
自然语言
    ↓
dictionary          得到 canonical_ref / 拆解候选
    ↓
ontology            以正式对象与约束为准
    ↓
后续任务 / 取证 / 判断
```

因此：

- Dictionary **不是**语义权威
- Runtime **不应**默认把本目录当知识正文全文注入
- Dictionary **不得**反过来修改 ontology 边界  
  （例如在词典里宣布「scenario 移出本体」「ResearchScope 改归属」）

架构 / 文件 / 模型归属迁移，放在：

[`../../05_control_evaluation/migrations/semantic_migration.yaml`](../../05_control_evaluation/migrations/semantic_migration.yaml)

---

## 4. 最重要的边界：不要变成第二套本体

正式本体已经有：

```text
id / namespace / definition / alias / relation / constraint / version
```

Dictionary **永远不要**再搞一套：

```text
id
type
relation
cardinality
version
constraint
```

否则马上变成 Ontology 2.0。

Dictionary 最好永远停在：

```text
term
  → canonical_ref
  → human meaning
  → alias
  → usage
  → ambiguity
  →（研究概念）anchor / decompose
```

到这里结束。

正式定义仍以 ontology 为准；dictionary 只做「让研究员看得懂、让归一化可执行」。

---

## 5. 五个文件分别解决什么

不建议再增加更多文件。当前五文件已经够用：

```text
02_dictionary/
├── 01_core_terms.yaml       正式概念的人类可读入口
├── 02_aliases.yaml          严格同义词
├── 03_research_terms.yaml   投研模糊概念 → 可验证语义
├── 04_ambiguity_rules.yaml  一词多义 / 口径澄清
├── 05_deprecated_terms.yaml 只保留「旧词 → 新词」
└── domains/                 领域补充，不改变上述分工
```

### 5.1 `01_core_terms.yaml` —— 标准术语表

解决：

> 「这个词到底是什么意思？」

例如「状态变量」：

- 告诉研究员：它是可随时间变化、可被观测的业务状态维度
- 提醒：稳定变量定义 ≠ 某一次观测值
- `canonical_ref` 指向 `ontology:StateVariable`

**这里不重新定义 StateVariable。**  
正式定义在 ontology；dictionary 只翻译成研究员语言，并给正例 / 反例。

适合放：已经是正式 ontology 概念、但需要人类口径说明的词。  
如：状态变量、证据事实、判断单元、产业链环节、预期差。

### 5.2 `02_aliases.yaml` —— 严格同义词

解决：

> 「不同的人叫法不一样怎么办？」

原则非常严：

> **只有能够无损替换的词，才叫 alias。**

可以：

```text
价值链环节 / Segment / 行业链环节
→ 产业链环节（ValueChainSegment）
```

不可以硬映射：

```text
赛道 → 行业          （近义，不一定等价）
财务指标 → Metric    （上下位：财务指标 ⊂ Metric）
上市主体 → Company   （角色，不是全体公司）
快照 → SourceSnapshot（与 StateSnapshot 冲突）
产能 → CapacityMetric（口径未定）
```

近义、上下位、语境相关词：放到 `03_research_terms` 或 `04_ambiguity_rules`。

否则 AI 归一化会把「近似」当成「等同」，后面全盘错。

### 5.3 `03_research_terms.yaml` —— 最有投研价值的一层

解决：

> 「这些口语很重要，但不能直接建成 ontology Object。」

例如「国产替代」不要做成：

```text
Ontology: 国产替代 = 某个对象
```

而应定义成研究概念，并**分开写两类信息**：

```text
anchor_types     这个概念发生在哪些对象上
                 Company / Product / ProcessStep / Region

decompose_to     最终要拆成什么可验证语义
                 StateVariable / Metric

variable_hints   常见可观测线索
                 market_share / qualification_progress / ...
```

这样机器能分清：

```text
发生在谁身上  →  拆成什么  →  可以看哪些变量
```

「景气度」「卡脖子」「订单能见度」「产能释放」「HBM 很紧」都按这个结构写。

如果一个词其实已经是正式对象（如「预期差」= `ExpectationGap`），放 `01_core_terms` / `02_aliases`，不要在这里再维护一份。

### 5.4 `04_ambiguity_rules.yaml` —— 强制消歧

解决：

> 「这个词一开口就有多种口径，先别搜证据。」

典型：

- 先进制程：≤7nm？≤5nm？公司自定义？
- 订单增长：新签 / 在手 / 合同负债 / backlog / shipment？
- 产能：名义 / 有效 / 已安装 / 规划？
- 快照：来源快照还是状态快照？
- 「有预期差」：是正式 ExpectationGap，还是口头「市场没反应」？

规则：

> 口径不清，不得开始取证。

### 5.5 `05_deprecated_terms.yaml` —— 旧词兼容

解决：

> 「项目演化后，旧名称怎么办？」

只收：

```text
旧词 → 新词
Segment → ValueChainSegment
行业链环节 → 产业链环节
```

不收：

```text
scenario.yaml 移到哪里
ResearchScope 改属哪个 model
词典文档迁到哪个目录
```

那些是架构迁移，不是词语废弃。

### 5.6 `domains/`

领域补充（半导体、资本市场），结构仍服从上面五类职责，不另起炉灶。

---

## 6. 一个完整例子

用户输入：

> 「中微在刻蚀设备的国产替代怎么样？」

归一化路径：

```text
中微
  → Company

刻蚀设备
  → Product / SemiconductorEquipment（领域别名与消歧）

国产替代
  → research_concept
  → anchor: Company / Product / ...
  → decompose: StateVariable / Metric
  → hints: qualification_progress, domestic_share, customer_adoption, ...

然后
  → ontology 正式对象与约束
  → 进入取证 / 判断
```

Dictionary 做的是前半段「听懂人话」；Ontology 做的是后半段「正式认账」。

---

## 7. 怎么用

| 你遇到的情况 | 去哪 |
|---|---|
| 正式概念想看人话解释 | `01_core_terms.yaml` |
| 叫法不同，但意思完全一样 | `02_aliases.yaml` |
| 投研口语，不能直接当对象 | `03_research_terms.yaml` |
| 一词多义、口径打架 | `04_ambiguity_rules.yaml` |
| 旧名称还在被使用 | `05_deprecated_terms.yaml` |
| 文件/模型搬迁了哪 | `05_control_evaluation/migrations/` |
| 正式定义、关系、约束 | `01_ontology/`，不要回 dictionary 找 |

最短路径：

1. 先问：这是正式概念，还是研究口语，还是歧义词？
2. 口语先拆 `anchor_types`，再拆 `decompose_to`
3. 歧义未消，不要取证
4. 拿到 `canonical_ref` 后，只信 ontology

---

## 8. 怎么维护

新增 / 修改时按这个顺序想：

1. **它是不是正式 ontology 概念？**  
   是 → 先改 ontology，再补 `core_terms` / 严格 `aliases`
2. **它能不能无损替换某个正式名？**  
   能 → `aliases`  
   不能 → `research_terms` 或 `ambiguity_rules`
3. **它是不是旧词换新词？**  
   是 → `deprecated_terms`  
   若是路径/归属变更 → governance migrations
4. **有没有在 dictionary 里发明 ontology 类型？**  
   有 → 删掉；只引用 ontology / domain extension 里真实存在的 `canonical_ref`

禁止：

- 在 dictionary 重写 relation / cardinality / constraint
- 用 dictionary 宣布 ontology 架构结论
- 把近义词塞进 aliases
- 把「预期差」这类已有正式对象再做成 research concept 副本
- 继续堆更多顶层文件；优先把内容放进现有五文件

登记入口：[`registry.yaml`](./registry.yaml)

---

## 9. 给谁看

- **研究员**：查口径、别名、歧义、研究用语怎么拆
- **维护者**：维护归一化条目；机器枚举仍只写 ontology
- **Runtime / Agent**：只把本目录当 lexical 前置，不当 semantic 权威

---

## 维护者附录

| 项 | 值 |
|---|---|
| status | `active` |
| role | lexical / normalization authority |
| semantic authority | `01_semantic_knowledge/01_ontology/` |
| architecture migration | `05_control_evaluation/migrations/semantic_migration.yaml` |
| 回答什么 | 人话如何归一到标准语义 |
| 不放什么 | 正式枚举平行副本、研究流程、单次结论、架构迁移账本、第二套本体 |
