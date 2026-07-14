---
document_type: industry_evidence_source_query_playbook
schema_version: 1.0.0
file_id: B03-IND-SEMI-OPS
updated_at: 2026-07-13
industry: semiconductor
status: ready_to_use
verified_at: 2026-07-13
---

# B03-IND-SEMI-OPS_半导体真实来源查询与口径手册

## 1. 定位

本手册是 [B03 半导体来源清单](B03-IND-SEMI_半导体取证来源清单.md) 的执行层，重点解决四件事：真实入口、查询步骤、数据口径和主源失败后的替代路线。通用公司披露、宏观和贸易查询方法见 [B02-OPS](../B02-OPS_通用真实来源查询与回退手册.md)。

半导体查询必须先固定“产品 × 产业环节 × 地区 × 业务时间”。没有这一层，多个真实来源也可能测量完全不同的对象。

```text
product_family
→ product_spec / node / wafer_size / package
→ chain_stage
→ geography / ship_to / customer_market
→ actual_or_forecast
→ calendar_or_fiscal_period
→ measure / unit / denominator
```

## 2. 来源操作卡

### QP-SEMI-01 WSTS 全球半导体销售

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [WSTS Historical Billings Report](https://www.wsts.org/67/Historical-Billings-Report)、[WSTS Market Statistics](https://www.wsts.org/61/MARKET-STATISTICS)、[SIA Market Data](https://www.semiconductors.org/data-resources/market-data/) |
| 免费查询 | WSTS 历史页下载 XLSX/PDF；SIA 月度新闻稿用于读取最新全球/区域销售和同比 |
| 授权查询 | WSTS Blue Book/History/Green Book；记录 report edition、download date、product category、region 和权限 |
| 核心口径 | WSTS billings 是非 captive 半导体厂商向最终客户、授权分销商及制造终端产品的关联主体按 ship-to 地点计算的净开票美元值，包含 NRE；不是终端消费，也不是晶圆产量 |
| 移动平均 | `3MMA_t = (M_t + M_t-1 + M_t-2) / 3`；`3/12` 比较本期三个月与上年同期三个月；不得把 3MMA 当单月值 |
| 必录字段 | `report_name`、`edition`、`month`、`region`、`product_category`、`billings_usd`、`raw_or_3mma`、`actual_or_forecast`、`revision` |
| 同源回退 | Blue Book → 免费 Historical Billings → WSTS/SIA 月度发布 |
| 跨源回退 | WSTS 细分授权不可得 → 代表性公司分项收入 + Omdia/Gartner/IDC 等商业研究；只能作为受限估计，不能冒充 WSTS 产品表 |
| 失败上限 | 只有 SIA 总量新闻稿时，可确认行业总量趋势，不能确认产品细分或公司份额 |

使用禁区：区域是 ship-to 市场，不自动等于终端需求地区、芯片生产地或公司总部地区；销售额同时受量、价、产品结构和汇率影响。

### QP-SEMI-02 SEMI/SEAJ 设备销售与 fab 数据

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [SEMI Billings Report](https://www.semi.org/en/products-services/market-data/equipment/billings-report)、[SEMI EMDS/WWSEMS](https://www.semi.org/en/products-services/market-data/emds)、[SEMI 历史 billings](https://www.semi.org/en/products-services/market-data/historical-billings)、[SEAJ Statistics](https://www.seaj.or.jp/english/statistics/) |
| 查询方法 | 免费发布先取季度/年度全球及区域总额；授权 WWSEMS 按 region × equipment category 取月度；World Fab Forecast/FabView 按 fab、wafer size、node、construction、equipment spending、capacity ramp 查询 |
| 核心口径 | SEMI North America Billings 为北美总部设备厂商的全球 billings，采用 3 个月平均；不是北美地区设备需求。WWSEMS 为全球供应商提交的设备 billings，按市场地区和设备类别汇总 |
| 必录字段 | `program`、`supplier_scope`、`market_region`、`equipment_category`、`period`、`monthly_or_3mma`、`billings_currency`、`booking_or_billing`、`actual_or_forecast` |
| 同源回退 | WWSEMS 授权表 → SEMI 季度新闻稿 → SEMI 历史数据；fab 数据库 → SEMI fab 新闻稿 |
| 跨源回退 | SEMI 细分不可得 → SEAJ + ASML/AMAT/Lam/KLA/TEL 等订单、收入与 backlog + 晶圆厂 capex |
| 失败上限 | 只能取得设备公司订单时，只能说明订单/预期，不能确认全市场设备 billings 或有效产能 |

必须区分 `booking → shipment → billing/revenue → installation → acceptance → production ramp`。任何前序状态都不能直接替代后序状态。

### QP-SEMI-03 TSMC 晶圆代工经营数据

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [TSMC Monthly Revenue](https://investor.tsmc.com/english/monthly-revenue)、[Quarterly Results](https://investor.tsmc.com/english/quarterly-results)、[Annual Reports](https://investor.tsmc.com/english/annual-reports) |
| 查询方法 | 月营收按年份进入固定页；季度页下载 earnings release、presentation、transcript 和 financial statements；年报查制程、平台、客户、风险和产能说明 |
| 必录字段 | `period`、`publication_date`、`consolidated_revenue_ntd`、`audited_flag`、`wafer_revenue_by_node`、`platform_mix`、`wafer_shipments_unit`、`capacity_unit`、`capex_currency`、`guidance_or_actual` |
| 口径边界 | 月营收为合并净营收、以新台币百万元披露且当年数通常未经审计；不等于 wafer shipment、ASP 或 AI 收入。制程占比通常是 wafer revenue mix，不是 wafer volume mix |
| 同源回退 | 月度页 → MOPS 月营收 → 季度报告；季度 presentation → earnings release/财务报表/电话会文字 |
| 跨源回退 | 单季公司披露缺字段 → UMC/SMIC/GFS 同业 + SEMI fab/capex + 设备公司订单 |
| 失败上限 | 只有月营收时，可确认收入趋势，不能确认产能利用率、价格、节点供给或客户需求来源 |

跨期换算时保留原始新台币值；美元换算另列汇率来源和平均/期末口径，不覆盖原值。

### QP-SEMI-04 存储原厂实际经营

| 公司 | 正式入口 | 优先取数 |
|---|---|---|
| Micron | [Micron Investors](https://investors.micron.com) | DRAM/NAND revenue、bit shipment、ASP 变化、库存、capex、毛利率、终端需求和指引 |
| SK hynix | [SK hynix IR](https://www.skhynix.com/ir) | DRAM/NAND/HBM 收入、bit growth、ASP、capex、HBM 进展、库存和指引 |
| Samsung Electronics | [Samsung Global IR](https://www.samsung.com/global/ir/) | DS/memory 分部收入利润、capex、库存与市场说明 |
| Kioxia | [Kioxia Holdings IR](https://www.kioxia-holdings.com/en-jp/ir.html) | NAND/SSD 收入、产量调整、capex 和财务 |
| SanDisk/Western Digital | 各自公司 IR 与 SEC filing | NAND、client/cloud storage、库存和价格传导 |

查询方法：

1. 下载季度 earnings release、presentation、prepared remarks、transcript 和财务附表；
2. 分别搜索 `DRAM`、`NAND`、`HBM`、`bit shipment`、`ASP`、`inventory`、`capex`、`utilization`；
3. 把管理层实际值、环比描述、下一季指引和长期目标分列；
4. 财年季度映射到自然时间，保留公司原始 fiscal period；
5. 至少两家原厂交叉，不以一家产品组合代表全市场。

口径合同：

| 字段 | 必须记录 |
|---|---|
| bit shipment growth | DRAM/NAND/HBM、QoQ/YoY、actual/guidance、基期 |
| ASP change | 产品范围、QoQ/YoY、名义/常数汇率、公司实现价而非市场报价 |
| inventory | 金额/天数、原材料/在制品/成品、净额/减值前、报告日 |
| capex | 财年、现金支出/设备投资、memory/其他、计划/实际 |
| gross margin | consolidated/segment、GAAP/non-GAAP、减值和一次性影响 |

回退顺序：原始季度材料 → SEC/DART 法定披露 → 电话会文字 → 同业披露。只有媒体转述时不计实际经营证据。

### QP-SEMI-05 TrendForce/DRAMeXchange 存储价格

| 项目 | 操作要求 |
|---|---|
| 真实入口 | [TrendForce](https://www.trendforce.com)、[DRAMeXchange](https://www.dramexchange.com)；授权账户进入对应 DRAM/NAND/HBM price/report 数据产品 |
| 查询方法 | 先选 DRAM/NAND/HBM，再固定 component/module、容量/density、speed、application、spot/contract、region、currency、frequency 和 price date |
| 必录字段 | `product_family`、`part_or_spec`、`capacity_density`、`speed`、`form_factor`、`market`、`spot_or_contract`、`high_low_average`、`currency`、`price_date`、`report_edition` |
| 口径边界 | spot、contract、module、chip 和公司 ASP 是不同价格；HBM 世代、stack height 和客户认证状态必须拆开；新闻中“涨价 x%”不能替代价格表 |
| 同源回退 | 授权价格表 → 同源公开 price trend/新闻稿 → 历史快照 |
| 跨源回退 | Micron/SK hynix/Samsung ASP 变化 + 渠道报价 + 模组厂披露；只能形成方向区间，不能伪造单一市场价 |
| 失败上限 | 规格、市场或 price type 缺一项时，只能作为价格线索 |

价格序列换规格时必须断开或做显式桥接；不得把停更产品的最后报价向后填充为当期价格。

### QP-SEMI-06 中国集成电路产量与产业运行

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [国家数据](https://data.stats.gov.cn/easyquery.htm?cn=A01)、[工信部电子信息制造业运行情况](https://www.miit.gov.cn/gxsj/tjfx/dzxx/index.html) |
| 查询方法 | 国家数据选月度产品产量，检索“集成电路”；工信部按 `YYYY年M月/1—M月 电子信息制造业运行情况` 检索并保存正文注释 |
| 必录字段 | `indicator`、`period`、`current_or_cumulative`、`unit`、`yoy_scope`、`source_note`、`publication_date`、`revision` |
| 核心口径 | “集成电路产量”按块/亿块统计，是产品数量，不是 wafer starts、die area、销售额、国产化率或先进制程产能；工信部累计运行稿常引用国家统计局并补充行业解释 |
| 同源回退 | 国家数据 → 国家统计局月度公报/年鉴；工信部网页 → 同部委移动页/年度运行稿 |
| 跨源回退 | 国家统计缺失 → 工信部运行稿 → CSIA 行业数据 → 代表性公司披露；后两者不能冒充国家统计口径 |
| 失败上限 | 只有累计产量时不能推单月边际，除非用相邻累计值复算并标注复算方法和春节错位 |

### QP-SEMI-07 中国半导体贸易暴露

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [海关统计平台](https://stats.customs.gov.cn)、[UN Comtrade Plus](https://comtradeplus.un.org) |
| 候选 HS6 | `8542` 集成电路总类；`854231` 处理器/控制器；`854232` 存储器；`854233` 放大器；`854239` 其他集成电路；`848620` 制造半导体器件或集成电路的机器及装置 |
| 查询方法 | 候选 HS6 只作为起点；每个统计年度回到中国海关商品编码确认更细位代码和名称，再按 flow、partner、period、trade regime 导出金额和数量 |
| 必录字段 | `hs_version`、`cn_commodity_code`、`hs6_parent`、`include_exclude_rule`、`flow`、`partner`、`period`、`qty_unit`、`value_currency`、`current_or_cumulative` |
| 口径边界 | HS 代码无法直接识别先进/成熟节点、HBM/普通 DRAM、设备工序、国产品牌或最终用途；贸易金额不等于公司收入和真实消费 |
| 同源回退 | 海关在线 → 海关月报/年鉴 → UN Comtrade 中国 reporter |
| 跨源回退 | reporter 缺失 → partner mirror → 公司进口依赖/供应链披露；不对镜像值简单平均 |
| 失败上限 | 只有 HS4 总类时，只能确认大类贸易方向，不能量化具体半导体产品暴露 |

### QP-SEMI-08 中国设备、材料和封测公司披露

查询顺序：

```text
巨潮/上交所证券代码
→ 年报：产品、客户、产能、在建工程、存货、合同负债、风险
→ 季报：收入、毛利、存货、现金流、资本开支
→ 临时公告/问询回复：订单、中标、验收、客户验证、项目进度
→ 机构调研/业绩会：管理层边际表述
→ 晶圆厂/客户、同业和行业数据交叉
```

必须把国产替代阶段编码为：

```text
sample
→ verification
→ pilot_run
→ line_acceptance
→ small_batch
→ mass_production
→ repeat_order
→ multi_line_or_multi_fab_replication
```

| 事实 | 合格定位 | 不得替代 |
|---|---|---|
| 中标 | 中标公告、招标项目、金额/数量/状态 | 收入确认、装机、份额 |
| 合同/订单 | 合同主体、金额、期限、履约条件 | 发货、验收、回款 |
| 验收 | 客户/公司正式披露、设备/产线和时间 | 批量采购、跨厂复制 |
| 量产 | 明确产品、产线、客户阶段和收入/出货佐证 | 送样、认证通过 |
| 复购 | 同客户后续订单或重复收入证据 | 一次首单 |

主源失败时依次使用交易所问询、客户/晶圆厂披露、招投标记录和同业验证；匿名调研只能作线索。无法跨过验证阶段时，04 结论最多停在“验证推进/条件性放量”。

### QP-SEMI-09 下游需求

| 下游 | 主源 | 关键查询口径 | 回退 |
|---|---|---|---|
| 智能手机/PC | IDC、Canalys/Omdia、Counterpoint、Gartner；品牌公司披露 | shipment/sell-in/sell-through、region、calendar quarter、vendor taxonomy | 工信部产量 + 品牌/ODM 披露；不能直接变成芯片采购 |
| 服务器/AI | IDC/Omdia/Dell'Oro；Dell/HPE/Supermicro/Lenovo；云厂商披露 | unit/revenue、AI/general purpose、accelerator count、deployment vs order | GPU/networking/HBM 公司收入交叉；总 capex 只能作上限线索 |
| 汽车 | OICA、ACEA、中汽协/乘联会、MarkLines；车企和芯片公司 | production/wholesale/retail/registration、NEV/ICE、region、inventory | 工业产出 + 车企披露；销量不等于半导体消耗 |
| 云 capex | Microsoft/Amazon/Alphabet/Meta/Oracle 等法定披露 | cash capex/additions、PP&E 类别、finance lease、data center/AI/land/building | 网络/服务器/GPU 公司披露；不得把总 capex 全部映射为芯片 |

下游到半导体的转换必须显式写：

```text
terminal_units
× semiconductor_content_per_unit
× product_share
± channel_inventory_change
± lead_time_timing_difference
= implied_chip_consumption
```

其中任何参数为代理时，记录来源、区间和失效条件。

## 3. 半导体统一测量字典

| 变量 | 合格定义 | 必须分列 | 常见不可比 |
|---|---|---|---|
| semiconductor sales | 净开票销售额 | actual/forecast、raw/3MMA、产品、ship-to 地区 | 终端消费、生产地、公司总部地区 |
| wafer capacity | 每月可处理 wafer 的名义或有效能力 | 8/12 英寸、node、product、installed/qualified/ramped | fab 数量、厂房规划 |
| wafer shipments | 实际出货晶圆数或 12-inch equivalent | 尺寸换算、季度、foundry/IDM | 营收、wafer starts |
| utilization | 实际投入或产出相对可用能力 | 公司定义、节点/工艺、季度 | 收入增速、设备稼动 |
| inventory | 指定链层的库存量、金额或天数 | supplier/channel/customer、raw/WIP/FG、gross/net | 单家公司库存金额、渠道周数 |
| memory price | 指定规格和市场的价格 | spot/contract/ASP、chip/module、容量/速度 | 新闻报价、不同规格均价 |
| WFE/equipment billings | 指定供应商和设备范围的开票/收入 | region、category、monthly/3MMA | fab capex、订单、有效产能 |
| capex | 固定期间资本支出 | cash/additions、actual/guidance、segment | WFE 总额、订单收入 |
| market share | 明确分子/分母的份额 | revenue/unit/bit/capacity、product、region、period | 厂商排名、产能份额与收入份额 |

## 4. 主源失败替代矩阵

| 目标测量 | 直接主源 | F1 同生产者 | F2 独立替代 | F3 代理 | 回退后上限 |
|---|---|---|---|---|---|
| 全球半导体销售 | WSTS Blue Book | WSTS Historical/SIA 月报 | Omdia/Gartner + 公司分项 | 代表公司收入指数 | F2/F3 不能称 WSTS 口径市场规模 |
| 设备销售 | WWSEMS | SEMI 新闻稿/历史 billings | SEAJ + 设备公司收入 | 晶圆厂 capex | F3 只能判断投资意愿 |
| 存储价格 | 授权规格价格表 | 同源公开趋势 | 原厂 ASP + 模组/渠道 | 毛利率/库存 | 不生成伪精确价格 |
| foundry 利用率 | 公司季度披露 | transcript/年报 | 同业 + wafer shipment | ASP/交期 | 代理只支持条件判断 |
| 中国 IC 产量 | 国家统计局 | 工信部运行稿 | CSIA/地方统计 | 公司产量/收入 | 不能外推全国产量 |
| 国产替代阶段 | 公司/客户正式披露 | 问询/调研记录 | 招投标 + 同业/晶圆厂 | 专家访谈 | 无客户/复购验证不得写份额提升 |
| 下游需求 | 专业出货/部署数据 | 同源新闻稿 | 品牌/渠道公司披露 | 上游芯片收入 | 上游收入不能替代终端需求 |

## 5. 失败代码的半导体解释

| failure_code | 半导体场景 | 默认动作 |
|---|---|---|
| `access_denied` | WSTS/SEMI/TrendForce/Omdia 授权不可得 | 使用预设 F1/F2；明确缺失粒度，不用研报转引补强 |
| `field_unavailable` | 公司不再披露 utilization、bit growth 或 ASP | 查 transcript/年报；转向同业和可校准代理 |
| `scope_mismatch` | 全球/区域、DRAM/NAND/HBM、先进/成熟节点错位 | 不计入当前测量，重查分项 |
| `time_mismatch` | 月度价格与季度财务、财年与自然年错位 | 建时间桥接，不用未来信息回填历史时点 |
| `method_opaque` | 商业来源样本、规格或模型不明 | 只作交叉线索，不能作主测量 |
| `trace_missing` | 卖方只给数字无原始表/报告 edition | 回源；失败则不进入正式证据 |
| `channel_error` | 页面脚本、验证码、下载故障 | 同来源换通道，保留 SourceProfile |

## 6. 停止规则

对一个半导体判断，只有在产品粒度固定、主测量可复核、公司或上下游至少一侧完成交叉、时间桥接清楚、预测与实际分开、反证已检查时停止。授权源不可得不是无限搜索弱来源的理由；应转为缺口、受限代理和后续监测项。
