---
document_type: industry_evidence_source_registry
schema_version: 1.1.0
file_id: B03-IND-SEMI
file_name: B03-IND-SEMI_半导体取证来源清单.md
generated_at: 2026-07-13
industry: semiconductor
status: ready_to_use
revision: measurement_granularity_and_triangulation
---

# B03-IND-SEMI_半导体取证来源清单

## 半导体取证先按产业时钟拆开

| 研究环节 | 优先观察 | 最容易混淆 |
|---|---|---|
| 终端与系统需求 | 实际销量、部署、利用和内容量 | capex、订单意向当真实消耗 |
| 设计与采购 | design win、订单、backlog、取消 | 定点/订单当量产收入 |
| 制造供给 | 投片、稼动、良率、产品组合、可交付产出 | 厂房/月产能当有效供给 |
| 封测与系统瓶颈 | 合格产出、关键设备/材料、交期 | 名义封装产能当系统交付 |
| 设备材料国产化 | 验证阶段、产线层级、复购、跨厂复制 | 送样/首单当份额提升 |
| 财务兑现 | 实现价、收入确认、毛利、库存、现金 | 行业价格直接套公司利润 |

半导体来源常覆盖不同产品、节点、晶圆尺寸和客户。任何“行业数据”进入核心判断前，都要先确认分项能否与 02 的对象匹配。

## 1. 定位

本文是 03 取证策略库中面向**半导体行业**的行业专用来源清单，用于补充 B02 通用来源。

B02 负责政策、公司披露、金融市场、宏观、贸易、商品、新闻、研报等跨行业来源；本文只负责半导体行业专用变量，包括：

1. 全球半导体销售和周期；
2. 细分产品供需、价格、出货、库存；
3. 晶圆制造、设备、材料、封装、测试等产业链变量；
4. AI、服务器、手机、PC、汽车、工业、光通信等下游需求；
5. 公司层面的产能、资本开支、ASP、库存、毛利率和订单变化；
6. 半导体行业判断中的反证来源。

本文不是半导体网站大全，只保留投研取证中高频、可用、可解释使用边界的来源。

## 2. 使用规则

1. 政策、制裁、出口管制、关税、宏观、贸易和行情，先查 B02。
2. 半导体行业变量，如 WSTS 销售、设备支出、存储价格、晶圆代工利用率、先进封装产能、材料供给、下游出货，查本文。
3. 对关键判断，行业数据最好与公司披露、下游数据或一手调研交叉验证。
4. 行业数据不得直接推出公司盈利弹性，必须通过公司收入结构、量价口径、成本结构、产能利用率和毛利率传导。
5. 新闻、行业媒体、卖方研报可用于线索和观点分歧，但关键数值应追溯到原始来源。
6. 预测、指引、估算、传闻必须与已发生事实分开。
7. 涉及中国半导体产业链时，必须同时查中国侧产业、海关、工信部、公司公告和 A/H 股披露，不得只用海外行业数据库或中文行业新闻。


### 2.1 中国半导体取证优先规则

中国半导体取证应采用“全球行业源 + 中国侧主源 + 公司披露 + 下游验证”的组合：

| 证据层 | 中国侧优先来源 | 适合证据 | 使用边界 |
|---|---|---|---|
| 产业运行 | 工信部电子信息制造业运行情况、国家统计局工业产品产量、中国半导体行业协会 CSIA | 电子信息制造业、集成电路产量、行业运行、设计/制造/封测结构 | 工信部/统计局偏宏观，CSIA 偏行业协会，不能替代公司经营事实 |
| 进出口 | 海关总署统计查询平台、商务部数据中心 | 集成电路、设备、材料、硅片、电子元器件相关 HS 进出口 | HS code 必须逐项核对，不能用“集成电路”大类替代具体产品 |
| A/H 股公司披露 | 巨潮资讯、上交所、深交所、北交所、HKEXnews、公司 IR | 产能、capex、收入结构、客户、库存、毛利率、风险因素 | 公司披露只能代表公司自身；不能直接外推行业 |
| 国内设备/材料/封测链 | 北方华创、中微公司、盛美上海、拓荆科技、芯源微、长川科技、华峰测控、长电科技、通富微电、华天科技、沪硅产业、TCL 中环、安集科技、江丰电子、雅克科技等披露 | 国产设备、材料、封测、硅片、测试需求和订单变化 | A 股公司指引和订单表述需与财报、公告、同业和下游验证 |
| 国内下游需求 | 信通院、工信部、IDC/Canalys/Counterpoint 中国口径、中汽协、乘联会、国家能源局、云厂商和互联网公司披露 | 手机、PC、服务器、汽车、新能源、工业、云资本开支 | 下游出货/装机不能直接等同芯片采购，要考虑库存和 BOM/单耗 |
| 国内价格/材料 | SMM、Mysteel、百川盈孚、隆众资讯、卓创资讯、公司采购/成本披露 | 稀土、小金属、电子化学品、工业硅、碳酸锂、能源化工 | 商品价格不能单独证明半导体级材料短缺，需看认证、纯度、客户导入 |

## 3. 半导体核心必要证据组合

| Basket ID / 半导体子项 | 需要回答的问题 | 典型变量 |
|---|---|---|
| `CYCLE_DEMAND` / 细分产品与下游需求 | 哪些产品强，终端需求来自哪里？ | memory、logic、analog、手机、PC、服务器、汽车、工业等出货和收入 |
| `CYCLE_SUPPLY` / 供给与产能 | 有效供给是否紧张？ | wafer capacity、utilization、capex、equipment shipment、lead time、yield |
| `CYCLE_INVENTORY_ORDER` / 库存与订单 | 在去库、补库还是累库，需求是否真实传导？ | supplier/channel/customer inventory、backlog、book-to-bill、客户排产 |
| `CYCLE_PRICE` / 价格与 ASP | 价格是否上涨、下跌或分化？ | spot price、contract price、ASP、wafer price、module price |
| `TRANS_INTERMEDIATE_NODE` / 产业链瓶颈 | 约束在哪个环节？ | equipment、wafer、HBM、CoWoS、substrate、materials、testing |
| `DIFF_EXPOSURE` / 公司暴露 | 哪些公司受影响、暴露在哪里？ | 收入结构、客户结构、产能、ASP、库存、capex、毛利率 |
| `EXPECT_PRIOR_CONSENSUS` / 市场预期 | 事件前市场预期是什么？ | 一致预期、样本、vintage、卖方观点分布 |
| `EXPECT_PRICE_REACTION` / 定价反应 | 新信息后市场怎样反应？ | 相对收益、成交、估值和风险溢价 |
| `COUNTER_GENERAL` / 反证 | 什么会推翻判断？ | 价格回落、库存累积、订单取消、capex 下修、下游出货低于预期 |

## 4. 必要证据组合到来源映射

下表第一列是半导体来源任务标签，不是 Basket ID；运行时必须挂接到上表或 `00_basket_registry.yaml` 的稳定 ID。

| 来源任务标签（非 Basket ID） | 首选来源 | 交叉验证来源 | 替代/线索来源 | 常见错误 |
|---|---|---|---|---|
| 全球半导体销售 | WSTS、SIA | Gartner、Omdia、IDC、公司披露 | 新闻转述、卖方研报 | 用单月收入直接判断周期，不看 3MMA 和产品结构 |
| 半导体设备 | SEMI、SEAJ、设备公司披露 | ASML、Applied Materials、Lam Research、KLA、Tokyo Electron、Screen、Advantest、Teradyne | 卖方研报、行业新闻 | 把设备销售当作同步需求，不考虑 capex 滞后 |
| 晶圆厂产能/扩产 | SEMI World Fab Forecast、Knometa、公司 capex、公司公告 | TSMC、Samsung、SMIC、UMC、GlobalFoundries、Intel 披露 | 政府项目备案、新闻 | 把名义产能等同有效供给 |
| 晶圆代工景气 | TSMC、UMC、SMIC、GlobalFoundries、Samsung Foundry 披露 | TrendForce、Omdia、设备订单、下游需求 | 行业媒体 | 不区分先进制程、成熟制程和特殊工艺 |
| 存储价格 | TrendForce、DRAMeXchange、公司 ASP 披露 | Micron、Samsung、SK hynix、Kioxia、Western Digital 披露 | 渠道报价、卖方引用 | 用 spot price 直接代表 contract price 或公司 ASP |
| 存储供需 | TrendForce、Omdia、WSTS、公司财报/法说会 | 下游服务器、PC、手机出货和库存 | 行业新闻、卖方纪要 | 把 DRAM、NAND、HBM 放进同一个周期阶段 |
| HBM / AI memory | SK hynix、Samsung、Micron 披露；TrendForce、Omdia | NVIDIA、AMD、云厂商 capex、先进封装来源 | SemiAnalysis、卖方研报 | 只看 AI 需求，不看封装、良率、客户认证和产能锁定 |
| 先进封装 | TSMC、ASE、Amkor、JCET、Tongfu、Huatian 披露；Yole、TechInsights、SEMI | HBM 厂商、基板厂、测试设备厂、GPU 厂商披露 | SemiAnalysis、行业新闻 | 把 CoWoS、2.5D、基板、测试、HBM 统称为“封装产能” |
| 半导体材料 | SEMI、TECHCET、Yole、材料公司披露 | SUMCO、Shin-Etsu、GlobalWafers、JSR、TOK、Entegris、Merck、DuPont、Air Liquide、Linde | 化工/小金属价格、新闻 | 只用材料价格推断供给瓶颈，不看认证和替代周期 |
| EDA/IP/设计活动 | Synopsys、Cadence、Siemens EDA、Arm 披露 | Fabless 公司研发、流片和设计项目 | 卖方研报、行业媒体 | 把 EDA 收入变化直接等同全行业设计景气 |
| 手机需求 | IDC、Canalys、Counterpoint、Gartner | Apple、Samsung、小米、OPPO、vivo、联想供应链披露 | 新闻 | 手机出货不等于半导体需求，需要看库存和 BOM/单机价值 |
| PC 需求 | IDC、Canalys、Gartner | Lenovo、HP、Dell、Apple、Acer、Asus 披露 | 新闻 | PC 出货和 DRAM/CPU/SSD 需求存在库存错位 |
| 服务器/数据中心 | IDC、Omdia、Dell’Oro、Synergy Research | Dell、HPE、Supermicro、Arista、NVIDIA、AMD、Broadcom、Marvell 披露 | SemiAnalysis、新闻 | 不区分通用服务器和 AI 服务器 |
| 云资本开支 | Microsoft、Amazon、Google、Meta、Oracle、CoreWeave 等公司披露 | NVIDIA、AMD、Broadcom、Marvell、Arista 披露 | 卖方 capex 汇总 | 把总 capex 直接等同 AI 芯片需求 |
| 汽车半导体 | OICA、ACEA、CAAM、中汽协、乘联会、MarkLines、S&P Global Mobility | Infineon、STMicro、onsemi、NXP、Renesas、TI 披露 | 车企披露、新闻 | 汽车销量不等于车规半导体需求，需看库存和单车价值 |
| 工业/功率半导体 | Infineon、STMicro、onsemi、TI、ADI、Renesas 披露 | PMI、工业产出、自动化企业披露 | 新闻、卖方研报 | 不区分工业、汽车、消费和能源需求 |
| 光通信/硅光 | LightCounting、Dell’Oro、Omdia、Cignal AI、公司披露 | Coherent、Lumentum、Fabrinet、新易盛、中际旭创、天孚通信等披露 | 行业媒体、专家纪要 | 把光模块需求直接等同上游 InP/硅光/激光器需求 |
| 市场预期 | Wind、Bloomberg、FactSet、LSEG、iFinD、Choice | 卖方观点分布、股价反应、估值变化 | 新闻叙事、专家观点 | 把基本面改善直接等同预期差 |
| 反证 | 与主证据同层级的反向来源 | 同业披露、下游数据、价格/库存/订单反向变化 | 新闻和卖方线索 | 只查支持证据，不查价格回落、库存累积和订单取消 |


### 4.1 中国半导体必要证据组合补充矩阵

| 来源任务标签（非 Basket ID） | 中国侧首选来源 | 交叉验证来源 | 常见错误 |
|---|---|---|---|
| 中国集成电路产量 | 国家统计局、工信部电子信息制造业运行情况 | CSIA、地方统计、公司披露 | 把“块/个/亿块”口径混用；把产量等同销售额 |
| 中国 IC 进出口 | 海关总署统计查询平台、商务部数据中心 | UN Comtrade、公司披露、行业协会 | 不核对 HS code、数量单位、币种和转口贸易 |
| 国产替代/设备订单 | 北方华创、中微公司、拓荆科技、盛美上海、芯源微、华海清科、长川科技、华峰测控公告 | 晶圆厂 capex、招投标、设备交付和收入确认 | 把中标/订单/收入/装机混为一谈 |
| 晶圆制造中国暴露 | SMIC、华虹、华润微、士兰微、晶合集成、合肥长鑫/长鑫存储公开资料 | 设备公司订单、地方项目披露、海关设备进口 | 把名义扩产等同有效产能；忽略良率和制程节点 |
| 国内封测与先进封装 | 长电科技、通富微电、华天科技、甬矽电子、伟测科技、利扬芯片、颀中科技公告 | ASE/Amkor/TSMC、Yole/TechInsights、基板/测试设备披露 | 把传统封测收入等同先进封装瓶颈 |
| 半导体材料中国供给 | 沪硅产业、TCL 中环、立昂微、安集科技、江丰电子、雅克科技、鼎龙股份、南大光电、彤程新材、华特气体、金宏气体公告 | SMM/Mysteel/百川/隆众、TECHCET/SEMI/Yole | 用商品价格直接判断半导体级材料供给 |
| 国内下游需求 | 工信部、信通院、中汽协、乘联会、国家能源局、云厂商/服务器厂商披露 | IDC/Canalys/Counterpoint、公司披露 | 把手机/汽车/服务器出货直接等同芯片需求 |
| 中国市场预期 | Wind、iFinD、Choice、中证指数、卖方观点分布、A/H 股价反应 | 公司公告、业绩预告、机构调研 | 把股价反应当基本面事实 |
| 反证 | 同层级中国来源：价格回落、库存上升、订单延迟、capex 下修、下游出货走弱 | 海外同业、全球行业数据 | 只查海外反证或只查中国反证，忽略口径差异 |

## 5. 来源清单：按半导体产业链整理


### 5.0 中国半导体底层来源

| 来源 | 推荐入口 | 适合证据 | 使用限制 |
|---|---|---|---|
| 工信部电子信息制造业运行情况 | https://www.miit.gov.cn | 电子信息制造业收入、利润、出口交货值、手机/PC/集成电路产量等 | 偏宏观月度/年度运行，不能直接代表半导体公司业绩 |
| 国家统计局国家数据 | https://data.stats.gov.cn | 工业产品产量、工业增加值、工业企业利润、价格指数 | 集成电路产量口径需记录“块/亿块”等单位 |
| 中国半导体行业协会 CSIA | https://www.csia.net.cn | 中国 IC 产业销售、设计/制造/封测结构、行业运行分析 | 协会数据需核对发布时间、统计范围和是否为二次转述 |
| 海关总署统计查询平台 | https://stats.customs.gov.cn | 集成电路、半导体设备、硅片、材料、电子元器件进出口 | HS code、报告国、数量单位、币种、统计期必须记录 |
| 商务部数据中心 | https://data.mofcom.gov.cn | 中国外贸、分国别/商品贸易、部分整理数据 | 需回溯其数据来源，通常仍以海关为主 |
| 巨潮资讯/交易所公告 | https://www.cninfo.com.cn / https://www.sse.com.cn / https://www.szse.cn | A 股半导体公司公告、定期报告、问询函 | 法定披露主源，优先于公司新闻稿和媒体报道 |
| HKEXnews | https://www.hkexnews.hk | 港股半导体和电子产业链公司披露 | A+H 公司需要分别核对披露口径 |
| 地方工信/发改/统计部门 | 各省市官方入口 | 地方半导体项目、园区、投资、产量、政策 | 地方新闻稿和招商稿不能替代正式公告和公司披露 |
| SMM/Mysteel/百川盈孚/隆众资讯/卓创资讯 | 对应数据入口 | 国内材料、小金属、化工、能源价格和库存 | 多数为商业数据，需记录权限、规格、地区和口径 |

### 5.1 全球半导体销售与行业周期

| 来源 | 推荐入口 | 适合证据 | 使用限制 |
|---|---|---|---|
| WSTS | https://www.wsts.org | 全球半导体销售、区域、产品、月度数据、3MMA、历史周期 | 免费历史数据有限；更细分数据可能需订阅 |
| SIA | https://www.semiconductors.org/data-resources/market-data/ | 全球半导体月度销售、行业评论、政策背景 | SIA 月度销售基于 WSTS 数据，需注意是否为二次发布 |
| Gartner | https://www.gartner.com | 半导体收入、厂商排名、终端市场研究 | 商业数据，需记录权限和口径 |
| Omdia | https://omdia.tech.informa.com | 半导体市场、终端、产品线、供应链研究 | 商业数据，需记录产品和区域口径 |
| IDC | https://www.idc.com | 终端市场、半导体相关终端需求、数据中心和设备 | 更多用于下游需求交叉验证 |

使用建议：

1. 行业周期先看 WSTS/SIA 的全球销售、区域和产品结构。
2. 判断“周期阶段”时不要只看单月同比，应结合 3MMA、环比、产品结构和下游库存。
3. WSTS/SIA 适合确认行业大周期，不直接支持单家公司盈利弹性。

### 5.2 设备、资本开支与晶圆厂扩产

| 来源 | 推荐入口 | 适合证据 | 使用限制 |
|---|---|---|---|
| SEMI | https://www.semi.org/en/products-services/market-data/equipment | 半导体设备市场、WFE、fab forecast、材料和供应链研究 | 商业数据较多，需记录订阅和口径 |
| SEAJ | https://www.seaj.or.jp/english/statistics/ | 全球/日本半导体设备统计、WWSEMS | 年度或阶段性统计，更新频率有限 |
| ASML | https://www.asml.com/en/investors | EUV/DUV 设备订单、收入、backlog、客户需求 | 公司披露只能代表 ASML 口径 |
| Applied Materials | https://www.appliedmaterials.com/company/investor-relations | WFE、设备需求、订单、终端应用 | 需与 SEMI 和同业交叉验证 |
| Lam Research | https://investor.lamresearch.com | 刻蚀/沉积设备需求、客户 capex | 需区分 memory 与 foundry/logic |
| KLA | https://ir.kla.com | 过程控制、量测检测设备需求 | 设备种类与晶圆厂 capex 映射需说明 |
| Tokyo Electron | https://www.tel.com/ir/ | 半导体设备收入、区域、应用结构 | 日元和美元口径需处理 |
| Screen Holdings | https://www.screen.co.jp/en/ir | 清洗等设备需求 | 适合作为设备链交叉验证 |
| Advantest / Teradyne | https://www.advantest.com/investors / https://investors.teradyne.com | 测试设备需求，AI/HPC/存储测试景气 | 测试设备和芯片出货存在结构差异 |
| Knometa | https://knometa.com | 晶圆产能、fab database、产能结构 | 商业数据库，需授权和口径说明 |

使用建议：

1. 判断产能扩张，优先组合 SEMI/SEAJ + 设备公司订单/backlog + 晶圆厂 capex。
2. 设备订单通常领先或滞后于实际产能释放，不可等同当期有效供给。
3. 名义产能、装机进度、良率、认证和客户导入必须分开。

### 5.3 晶圆代工、逻辑和先进制程

| 来源 | 推荐入口 | 适合证据 | 使用限制 |
|---|---|---|---|
| TSMC | https://investor.tsmc.com | 月营收、季度财报、capex、制程收入、AI/HPC 需求、产能说明 | 月营收不等于出货量，制程口径需一致 |
| Samsung Electronics | https://www.samsung.com/global/ir/ | Foundry、memory、display、capex、管理层指引 | 业务分部披露粒度有限 |
| Intel | https://www.intc.com | IDM、foundry、capex、制程和产能计划 | 计划和实际量产必须区分 |
| UMC | https://www.umc.com/en/IR | 成熟制程、产能利用率、ASP、capex | 成熟制程不能代表先进制程 |
| SMIC | https://www.smics.com/en/site/company_financialSummary | 中国大陆晶圆代工、产能、利用率、capex | 需结合公告和业绩会口径 |
| GlobalFoundries | https://investors.gf.com | 成熟制程、长期协议、汽车和工业需求 | 长协不等于短期价格弹性 |
| TrendForce / Omdia | https://www.trendforce.com / https://omdia.tech.informa.com | 代工市场份额、产能、价格和终端应用 | 商业研究，需记录方法论和版本 |

使用建议：

1. 晶圆代工景气要拆为先进制程、成熟制程、特殊工艺，不要合并判断。
2. 产能利用率要结合 ASP、产品组合、客户需求和 capex。
3. AI/HPC 强不一定代表消费、汽车、工业同步改善。

### 5.4 存储：DRAM、NAND、HBM

| 来源 | 推荐入口 | 适合证据 | 使用限制 |
|---|---|---|---|
| TrendForce | https://www.trendforce.com | DRAM/NAND/HBM 价格、供需、库存、市场研究 | 商业和公开内容混合，需记录口径 |
| DRAMeXchange | https://www.dramexchange.com | DRAM/NAND spot price、contract price、价格趋势 | spot、contract、module、chip 口径必须区分 |
| Samsung Electronics | https://www.samsung.com/global/ir/ | memory 收入、capex、库存、HBM 进展、管理层口径 | 分部披露较粗，需要同业交叉 |
| SK hynix | https://www.skhynix.com/ir | DRAM、NAND、HBM、bit growth、ASP、库存、capex | 适合 HBM 和高端 DRAM 判断 |
| Micron | https://investors.micron.com | DRAM/NAND bit shipment、ASP、库存、capex、数据中心需求 | 财年口径和自然年口径需转换 |
| Kioxia | https://www.kioxia-holdings.com/en-jp/ir.html | NAND 供给、capex、财务 | 披露频率和粒度有限 |
| Western Digital / SanDisk | https://investor.wdc.com | NAND、存储产品需求、库存、价格 | 公司业务结构变化需注意 |
| Omdia / Gartner | https://omdia.tech.informa.com / https://www.gartner.com | 存储市场规模、份额、需求结构 | 商业数据，需授权和方法论说明 |

使用建议：

1. DRAM、NAND、HBM 必须分开判断。
2. spot price 适合观察边际情绪和渠道变化，contract price 更接近公司收入传导。
3. HBM 不能只看 AI 需求，还要看良率、客户认证、先进封装、基板、测试和产能锁定。
4. 存储周期判断必须至少覆盖价格、bit growth、库存、capex、下游需求和公司毛利率。

### 5.5 先进封装、测试与基板

| 来源 | 推荐入口 | 适合证据 | 使用限制 |
|---|---|---|---|
| TSMC | https://investor.tsmc.com | CoWoS、先进封装 capex、AI/HPC 需求、产能扩张 | CoWoS 产能通常披露有限，需交叉验证 |
| ASE Technology | https://www.aseglobal.com/en/ir | OSAT、封测收入、先进封装、测试需求 | 需区分传统封测和先进封装 |
| Amkor | https://ir.amkor.com | 封装测试、先进封装、汽车和高性能计算需求 | 公司客户结构披露有限 |
| JCET | https://www.jcetglobal.com/en/investor-relations | 中国封测、先进封装、客户和产能 | A 股公告与官网 IR 需交叉 |
| Tongfu Microelectronics / Huatian | 公司公告、巨潮资讯 | 国内封测公司产能、收入、客户、capex | 需结合财报和公告原文 |
| Yole Group | https://www.yolegroup.com | 先进封装、基板、异构集成、市场规模和份额 | 商业研究，需记录版本和口径 |
| TechInsights | https://www.techinsights.com | 芯片拆解、先进封装、技术路线、市场研究 | 商业数据，适合技术验证和市场补充 |
| Ibiden / Unimicron / AT&S / Shinko | 公司 IR | ABF 基板、封装基板供需和 capex | 基板产能与封装产能不是同一变量 |
| Advantest / Teradyne | 公司 IR | AI/HPC/存储测试设备需求 | 测试设备需求与封装瓶颈需分开 |

使用建议：

1. “先进封装瓶颈”至少拆成 CoWoS/2.5D、interposer、substrate、HBM stacking、test、客户认证。
2. 不要把封测厂整体收入直接等同先进封装景气。
3. 基板、测试、HBM、CoWoS 任何一个环节都可能成为约束，必须逐项取证。

### 5.6 材料、硅片、电子气体和化学品

| 来源 | 推荐入口 | 适合证据 | 使用限制 |
|---|---|---|---|
| SEMI Materials Market Data | https://www.semi.org | 半导体材料市场、区域和品类 | 多数为商业数据 |
| TECHCET | https://techcet.com | 半导体材料、电子气体、CMP、光刻胶、湿化学品 | 商业研究，需授权和方法论 |
| Yole Group | https://www.yolegroup.com | 材料、设备、化合物半导体、先进封装 | 商业数据，需记录版本 |
| SUMCO / Shin-Etsu / GlobalWafers | 公司 IR | 硅片供需、价格、capex、客户需求 | 公司口径需与行业数据交叉 |
| JSR / TOK / Shin-Etsu Chemical | 公司 IR | 光刻胶、电子材料、半导体化学品 | 材料种类和制程节点需区分 |
| Entegris / Merck KGaA / DuPont | 公司 IR | 电子材料、过滤、CMP、特气、湿化学品 | 多业务公司需拆分半导体相关收入 |
| Air Liquide / Linde / Air Products | 公司 IR | 工业气体、电子气体、长期合同 | 特气短缺需配合区域和客户信息 |
| SMM / Fastmarkets / Asian Metal / Mysteel | 对应数据入口 | 稀有金属、小金属、部分材料价格 | 商品报价不等同半导体级材料有效供给 |

使用建议：

1. 材料短缺不能只看商品价格，必须看半导体级认证、纯度、客户导入周期和替代供应。
2. 材料公司披露通常比新闻更适合判断供需和价格传导。
3. 小金属价格适合作为成本或稀缺线索，但不能单独证明晶圆厂停产风险。

### 5.7 EDA、IP、设计和 Fabless

| 来源 | 推荐入口 | 适合证据 | 使用限制 |
|---|---|---|---|
| Synopsys | https://www.synopsys.com/company/investor-relations.html | EDA、IP、设计活动、AI 芯片设计需求 | EDA 收入滞后于终端需求 |
| Cadence | https://investors.cadence.com | EDA、IP、系统设计、AI/HPC 设计活动 | 公司口径需与同业交叉 |
| Siemens EDA | Siemens IR / Siemens Digital Industries | EDA 和工业软件相关口径 | 披露粒度可能有限 |
| Arm | https://investors.arm.com | IP 授权、royalty、终端和 AI 相关设计活动 | royalty 滞后于芯片出货 |
| NVIDIA | https://investor.nvidia.com | GPU、AI accelerator、networking、data center demand | 需求强不等于所有半导体环节同步受益 |
| AMD | https://ir.amd.com | CPU、GPU、AI accelerator、server/client demand | 需区分 data center、client、gaming、embedded |
| Broadcom / Marvell | 公司 IR | AI networking、ASIC、光互联、数据中心芯片 | ASIC/网络需求需与云 capex 交叉 |
| Qualcomm / MediaTek | 公司 IR | 手机 SoC、汽车、IoT、连接芯片 | 手机出货和渠道库存需配合下游数据 |

### 5.8 下游需求来源

#### 5.8.1 手机和 PC

| 下游 | 首选来源 | 公司交叉验证 | 使用限制 |
|---|---|---|---|
| 智能手机 | IDC、Canalys、Counterpoint、Gartner | Apple、Samsung、小米、OPPO、vivo、联想供应链 | 出货不等于芯片采购，需看库存和单机价值 |
| PC | IDC、Canalys、Gartner | Lenovo、HP、Dell、Apple、Acer、Asus | PC 出货与 CPU/DRAM/NAND 需求存在库存错位 |
| 消费电子 | 公司披露、IDC、GfK、Counterpoint | Apple、Sony、任天堂、消费电子供应链 | 需求弱复苏不一定带动上游补库 |

#### 5.8.2 服务器、AI 和云资本开支

| 下游 | 首选来源 | 公司交叉验证 | 使用限制 |
|---|---|---|---|
| 服务器 | IDC、Omdia、Dell’Oro、Synergy Research | Dell、HPE、Supermicro、Lenovo ISG | 传统服务器和 AI 服务器要分开 |
| AI 服务器 | TrendForce、Omdia、SemiAnalysis、公司披露 | NVIDIA、AMD、Broadcom、Marvell、Arista、Supermicro | SemiAnalysis 更偏专家/研究源，关键数据需交叉验证 |
| 云资本开支 | Microsoft、Amazon、Google、Meta、Oracle、CoreWeave 等公司财报和业绩会 | NVIDIA、AMD、Broadcom、Marvell、Arista | 总 capex 需拆分数据中心、AI、网络、土地建筑等 |
| 数据中心网络 | Dell’Oro、650 Group、Omdia、Arista、Broadcom、Marvell | 云厂商 capex、交换机/光模块公司披露 | 网络景气和 GPU/HBM 需求不同步 |

#### 5.8.3 汽车、工业、能源和光通信

| 下游 | 首选来源 | 公司交叉验证 | 使用限制 |
|---|---|---|---|
| 汽车 | OICA、ACEA、CAAM、中汽协、乘联会、MarkLines、S&P Global Mobility | Infineon、STMicro、onsemi、NXP、Renesas、TI、车企披露 | 汽车销量、库存、单车半导体价值量要分开 |
| 工业 | PMI、工业产出、自动化企业披露 | TI、ADI、Infineon、STMicro、onsemi、Renesas | 工业需求通常慢变量，不宜用短期新闻判断 |
| 新能源/电力 | IEA、EIA、国家能源局、光伏/储能协会、公司披露 | 功率半导体公司、逆变器/车企披露 | 终端装机和半导体需求存在库存和价格错位 |
| 光通信/硅光 | LightCounting、Dell’Oro、Omdia、Cignal AI | Coherent、Lumentum、Fabrinet、新易盛、中际旭创、天孚通信、博创科技 | 光模块、激光器、InP、硅光、DSP、交换机要拆开 |

## 6. 公司披露优先名单

以下公司不是投资标的推荐，而是半导体取证时常见的**事实来源生产者**。

| 环节 | 常用公司披露来源 |
|---|---|
| 晶圆代工 / IDM | TSMC、Samsung Electronics、Intel、SMIC、UMC、GlobalFoundries、Tower Semiconductor |
| 存储 | Samsung Electronics、SK hynix、Micron、Kioxia、Western Digital/SanDisk |
| 设备 | ASML、Applied Materials、Lam Research、KLA、Tokyo Electron、Screen、Advantest、Teradyne、ASM International |
| EDA/IP | Synopsys、Cadence、Siemens、Arm |
| Fabless / AI 芯片 | NVIDIA、AMD、Broadcom、Marvell、Qualcomm、MediaTek、Apple |
| 模拟/功率/MCU | Texas Instruments、Analog Devices、Infineon、STMicroelectronics、onsemi、NXP、Renesas、Microchip |
| 封测 | ASE Technology、Amkor、JCET、Tongfu Microelectronics、Huatian Technology、Powertech Technology |
| 基板/PCB | Ibiden、Unimicron、AT&S、Shinko、欣兴电子、南亚电路板、深南电路、沪电股份 |
| 硅片 | Shin-Etsu、SUMCO、GlobalWafers、Siltronic、TCL 中环、沪硅产业 |
| 材料/化学品/气体 | JSR、TOK、Shin-Etsu Chemical、Entegris、Merck KGaA、DuPont、Air Liquide、Linde、Air Products |
| 光通信/光芯片 | Coherent、Lumentum、Fabrinet、新易盛、中际旭创、天孚通信、光迅科技、博创科技 |


### 6.1 中国半导体公司披露优先名单

以下公司不是投资推荐，而是中国半导体链取证时高频可用的事实来源生产者：

| 环节 | 中国侧常用公司披露来源 |
|---|---|
| 晶圆代工 / IDM | SMIC、中芯国际、华虹半导体、华润微、士兰微、晶合集成、粤芯半导体公开资料、积塔半导体公开资料 |
| 存储 / 存储模组 | 兆易创新、北京君正、江波龙、佰维存储、澜起科技、长鑫存储公开资料、长江存储公开资料 |
| 半导体设备 | 北方华创、中微公司、盛美上海、拓荆科技、芯源微、华海清科、长川科技、华峰测控、精测电子、至纯科技 |
| 封测 / 测试 | 长电科技、通富微电、华天科技、甬矽电子、伟测科技、利扬芯片、颀中科技 |
| 硅片 | 沪硅产业、TCL 中环、立昂微、有研硅、神工股份 |
| 材料/化学品/气体 | 安集科技、江丰电子、雅克科技、南大光电、鼎龙股份、彤程新材、华特气体、金宏气体、晶瑞电材、上海新阳 |
| EDA/IP/设计 | 华大九天、芯原股份、概伦电子、寒武纪、海光信息、龙芯中科、韦尔股份、卓胜微、圣邦股份、思瑞浦、纳芯微 |
| PCB/基板/连接 | 深南电路、沪电股份、生益科技、兴森科技、胜宏科技、景旺电子 |
| 光通信/光芯片 | 中际旭创、新易盛、天孚通信、光迅科技、博创科技、源杰科技、仕佳光子 |
| 功率/模拟/MCU | 华润微、士兰微、斯达半导、新洁能、扬杰科技、时代电气、圣邦股份、思瑞浦、纳芯微、兆易创新 |

使用边界：

1. A 股公告、港股公告和公司 IR 优先于中文媒体报道。
2. 订单、中标、在手订单、合同负债、收入确认、发货和装机不是同一个变量。
3. 国产替代类判断必须同时查客户导入、认证周期、产品结构、毛利率和海外限制。
4. 公司披露的“需求旺盛”“国产替代加速”属于管理层表述，不能单独作为硬事实。

使用限制：

1. 公司披露适合确认公司自身事实，不等于行业整体事实。
2. 同一环节至少取 2-3 家代表性公司交叉验证，避免单公司特殊因素误导行业判断。
3. 公司披露中的“客户需求强”“库存正常”“capex 扩张”等表述，要用量价、库存、产能和下游数据验证。

## 7. 常见研究问题的推荐取证路径

### 7.1 存储芯片周期判断

```text
WSTS/SIA 全球半导体与 memory 数据
→ TrendForce/DRAMeXchange DRAM/NAND/HBM 价格
→ Samsung/SK hynix/Micron 财报和业绩会
→ 下游 AI server、PC、smartphone 出货和库存
→ capex/bit growth/库存/毛利率
→ 一致预期和股价反应
→ 反证：价格涨幅放缓、库存累积、PC/手机需求承压、capex 恢复
```

### 7.2 先进封装瓶颈判断

```text
TSMC CoWoS/先进封装 capex 和业绩会
→ ASE/Amkor/JCET/Tongfu/Huatian 封测披露
→ Ibiden/Unimicron/AT&S/Shinko 基板披露
→ SK hynix/Micron/Samsung HBM 产能和认证
→ Advantest/Teradyne 测试设备需求
→ NVIDIA/AMD/云厂商 AI 需求
→ 反证：基板产能释放、测试瓶颈缓解、HBM 良率改善、客户改设计
```

### 7.3 半导体设备景气判断

```text
SEMI/SEAJ 设备市场数据
→ ASML/AMAT/Lam/KLA/TEL/Screen/Advantest/Teradyne 订单和 backlog
→ TSMC/Samsung/Intel/SMIC/UMC capex
→ memory 与 logic/foundry capex 拆分
→ 政策补贴和出口管制用 B02 查官方来源
→ 反证：capex 下修、订单延迟、客户消化库存、出口限制升级
```

### 7.4 AI 需求对半导体链影响

```text
Microsoft/Amazon/Google/Meta/Oracle 等云厂商 capex
→ NVIDIA/AMD/Broadcom/Marvell/Arista 数据中心收入和指引
→ HBM：SK hynix/Samsung/Micron + TrendForce/Omdia
→ 先进封装：TSMC/ASE/Amkor/Yole/TechInsights
→ 网络和光通信：Dell’Oro/LightCounting/Omdia + Coherent/Lumentum/新易盛/中际旭创
→ 反证：云 capex 结构变化、GPU 交付放缓、HBM/封装供给释放、推理架构变化
```

### 7.5 地缘冲击对半导体影响

```text
B02：政策/制裁/出口管制/关税/贸易/能源/物流
→ B03：受影响半导体环节定位
→ 公司披露：供应链、客户、产能、风险因素
→ 行业数据：供需、价格、库存、下游需求
→ 反证：库存缓冲、替代供应、豁免、地区转移、需求未受影响
```

### 7.6 半导体材料短缺判断

```text
B02：商品/贸易/物流/政策来源
→ TECHCET/SEMI/Yole 材料行业来源
→ 材料公司披露：供应、价格、capex、客户需求
→ 晶圆厂和设备公司披露：是否影响生产或交付
→ 一手调研：认证周期、替代难度、库存水平
→ 反证：多供应商替代、库存充足、长协覆盖、需求端放缓
```


### 7.7 中国半导体链取证路径

```text
工信部/国家统计局/CSIA 确认中国产业运行和产量
→ 海关总署确认 IC、设备、材料、硅片等进出口暴露
→ A/H 股公司公告确认收入、产能、capex、订单、库存、毛利率
→ 国内下游需求：信通院/工信部/中汽协/乘联会/云厂商/服务器厂商
→ 国内材料和商品：SMM/Mysteel/百川/隆众/交易所
→ 全球行业源：WSTS/SIA/SEMI/TrendForce/Omdia/IDC/Gartner 交叉验证
→ 反证：进口替代不及预期、下游需求走弱、库存上升、订单延迟、价格回落、海外限制缓和或升级
```

## 8. 常见错误和降级规则

| 错误 | 后果 | 降级规则 |
|---|---|---|
| 用新闻判断半导体供需 | 新闻只能说明市场关注，不足以证明供需变化 | 降为线索，必须补 WSTS/SIA/TrendForce/Omdia/公司披露 |
| 用单点价格判断周期 | 容易误判短期波动 | 降为弱信号，必须补趋势、库存、订单和下游需求 |
| 把 DRAM、NAND、HBM 混成一个存储周期 | 掩盖结构性分化 | 必须拆分，否则不得形成方向性判断 |
| 把设备订单等同有效产能 | 忽视交付、安装、良率和认证 | 只能作为产能释放线索 |
| 把名义产能等同有效供给 | 忽视利用率、良率和客户认证 | 不得直接推供需宽松或紧张 |
| 用单家公司外推全行业 | 可能是公司特殊因素 | 至少补同业和行业数据 |
| 把管理层指引当已发生事实 | 混淆预测和事实 | 指引只能作为预期或计划证据 |
| 把卖方研报数据当原始来源 | 无法复核 | 必须追溯原始数据，否则降为观点线索 |
| 把 AI 需求强直接等同所有半导体受益 | 忽略环节差异 | 必须映射到 GPU、HBM、先进封装、网络、存储、功率等具体环节 |
| 只查支持证据，不查反证 | 结论不可审计 | 不得进入 04 方向性判断 |

## 9. 最小取证要求

半导体行业问题进入 04 前，至少满足：

1. **行业层证据**：至少 1 个行业专业来源，说明供需、价格、出货、库存或产能中的核心变量。
2. **公司层证据**：至少 1-2 家代表性公司披露，确认行业变量是否传导到收入、ASP、库存、capex、毛利率或订单。
3. **下游层证据**：如果判断涉及需求，必须有终端或客户侧来源，而不是只看上游公司表述。
4. **市场层证据**：如果判断涉及预期差，必须检查股价、估值、一致预期或卖方观点分布。
5. **反证层证据**：必须主动查找反向价格、库存、订单、capex、下游需求或替代解释。

如果缺少第 1 项或第 5 项，不得形成强方向性判断；只能输出条件判断、观察判断或缺口说明。

## 10. 一句话原则

> 半导体取证不能只问“有没有新闻和研报支持”，而要沿着产品、供需、价格、库存、产能、下游和公司财务传导逐层找主源，并用同层级反证校验。

## 11. 半导体测量字典

半导体来源只有绑定明确测量口径才有价值：

| 构念 | 不充分指标 | 更接近目标的测量 | 必须拆分的口径 |
|---|---|---|---|
| 需求 | 新闻热度、capex 总额 | 终端出货、系统部署、芯片消耗、订单/拉货 | 终端/系统/芯片，AI/非 AI，实际/计划 |
| 供给 | 规划产能、晶圆厂数量 | wafer start、有效产出、良率调整后供给 | 节点、晶圆尺寸、产品、量产阶段 |
| 库存 | 单家公司库存金额 | 原厂/渠道/客户分层库存量或天数 | 金额/数量、层级、产品、减值影响 |
| 价格 | 新闻报价、单一现货 | 同规格现货/合约/ASP/实现价 | 产品、容量、速度、市场、币种、税 |
| 设备需求 | fab capex 总额 | WFE 分项、设备订单、交付、验收 | memory/logic/foundry、设备类别、地区 |
| 材料需求 | fab 产能 | wafer start × 单耗 × 良率/回收 | 工艺节点、材料规格、认证产线 |
| 国产替代 | 样机、认证名单 | 量产、复购、跨线复制、份额和收入 | 客户、设备/材料类别、验证阶段 |
| 先进封装瓶颈 | 名义封装产能 | 合格产出、良率、关键设备/材料和交期 | CoWoS/其他平台、封装步骤、客户 |

## 12. 产品与产业链粒度规则

1. DRAM、NAND、HBM 不合并判断周期；必要时 DRAM 再拆 server/mobile/PC 和规格；
2. foundry 的成熟与先进节点、logic 与 memory capex 分开；
3. wafer capacity 必须标注尺寸、节点、产品适配和量产状态；
4. 设备订单、交付、验收、收入确认和回款是不同状态；
5. 材料送样、认证、小批、量产、复购和跨厂复制是不同状态；
6. GPU/加速器需求不能直接外推所有模拟、MCU、功率和消费芯片；
7. 中国进出口需记录 HS code 与其无法精确映射产品的限制。

## 13. 半导体来源三角验证

| 判断 | 行业主测量 | 公司/上下游验证 | 必查反证 |
|---|---|---|---|
| 存储上行 | 分项价格、库存、订单、供给 | 原厂 ASP/毛利/稼动、客户需求 | 通用需求弱、库存回升、新供给 |
| 设备景气 | WFE/capex 分项、fab 项目进度 | 设备订单、交付、验收、客户 capex | 延期、出口限制、订单取消 |
| 材料放量 | wafer start、单耗、认证阶段 | 材料公司量产/复购、fab 验证 | 低良率、单一客户、替代供应 |
| 先进封装瓶颈 | 合格产能、交期、设备材料 | foundry/OSAT/客户部署 | 良率改善、扩产释放、架构变化 |
| AI 传导 | 部署/出货与系统 BOM | GPU/HBM/封装/网络分项收入 | capex 结构、消化库存、供给放松 |

同一咨询机构的预测与其新闻稿属于同源；多家公司的披露可以互补，但公司共同引用同一行业数据时不算独立行业验证。

## 14. 预测与实际值管理

- WSTS、SEMI、TrendForce、Omdia、IDC 等预测必须标记 forecast vintage；
- 后续更新不覆盖当时预测，保留修订路径用于预期和复盘；
- 行业销售额同时受量、价、产品结构和汇率影响，不直接等同需求量；
- 公司 capex 指引不等于设备收入，必须经过地区、fab、设备类别和时间滞后；
- 市占率估计需记录分母、地区、产品和是否按收入/出货/产能计算。

## 15. 半导体来源停止规则

当分项口径已固定、主测量与公司/下游验证满足 Recipe、反证已覆盖，继续增加同类研报或新闻不会改变 readiness 时停止。若关键专业数据因授权不可得，应明确是 `access_denied`，按 A09 建代理，而不是用大量弱来源拼接成强结论。
