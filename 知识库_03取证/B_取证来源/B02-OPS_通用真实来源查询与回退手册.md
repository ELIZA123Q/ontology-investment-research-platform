---
document_type: evidence_source_query_playbook
schema_version: 1.0.0
file_id: B02-OPS-GENERAL
updated_at: 2026-07-13
scope: cross_industry_operational_queries
status: ready_to_use
verified_at: 2026-07-13
---

# B02-OPS_通用真实来源查询与回退手册

## 1. 定位

本手册把 B02 的“来源名称”展开成可执行查询。它只收录已经核验存在的正式入口，并为每类任务给出：

1. 从哪里进入；
2. 用什么字段和筛选条件查询；
3. 取得后必须固定什么数据口径；
4. 页面、权限、字段或范围失败时怎样回退；
5. 回退后最多还能支持什么强度的结论。

来源范围、S1—S8 分层和禁止用法仍以 [B01](B01_来源分层与使用边界.md) 与 [B02](B02_通用来源清单与证据类别映射.md) 为准。本手册不是网页抓取接口承诺；网页结构变化时先确认生产者和材料身份，再更换获取通道。

## 2. 查询前的统一参数合同

任何查询至少先写出以下参数，不能在看到结果后再倒填：

```text
target_claim
object_id / object_name / aliases
business_time_start / business_time_end
publication_cutoff
geography / market / jurisdiction
classification_version
measure / unit / currency / denominator
actual_forecast_flag
revision_or_vintage
access_scope
expected_locator
fallback_sequence
```

最低定位规则：

| 材料类型 | 最低 locator |
|---|---|
| 法规/政策 | 发布机关、标题、文号或 document number、发布日期、生效日、条款/附件 |
| 公司披露 | 发行人、证券代码或 CIK、form/公告类别、报告期、披露日、accession/公告链接、页码或章节 |
| 统计序列 | 生产机构、数据库/表名、指标或 series ID、频率、单位、季调、业务期、vintage |
| 贸易数据 | reporter、partner、flow、HS 版本、商品代码、period、数量单位、金额币种、贸易制度 |
| 市场数据 | 交易所/供应商、代码、字段、币种、复权、时间戳、时区、交易日历 |

## 3. 高频真实来源操作卡

### QP-GEN-01 中国政策与法规原文

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [中国政府网政策文件库](https://sousuo.www.gov.cn/zcwjk/policyDocumentLibrary)、[全国人大法律法规数据库](https://flk.npc.gov.cn)、各主管部委官网 |
| 查询方法 | 先用完整标题或发文字号精确检索；再用“主题词 + 发布机关 + 年份”；区分法律、行政法规、部门规章、规范性文件、征求意见稿和答记者问 |
| 必录字段 | `issuing_authority`、`document_number`、`publication_date`、`effective_date`、`status`、`scope`、`article_or_annex`、`supersedes_or_amends` |
| 口径边界 | 发布日不等于生效日；征求意见不等于正式规则；政策目标、预算安排和执行结果是三项不同事实 |
| 同源替代 | 正文 HTML → 同机关 PDF/附件 → 国务院公报或主管机关公报 |
| 跨源回退 | 主管机关官网不可用 → 中国政府网/人大数据库核对 → 官方新闻稿只用于定位原文 |
| 失败上限 | 找不到正式文本或无法确认版本时，只能登记 `trace_missing`，不得确认规则事实 |

执行顺序：

```text
完整标题/文号
→ 核对发布机关与页面域名
→ 打开正文和全部附件
→ 查“施行、废止、有效期、过渡期、另行规定”
→ 查后续修订、解释、配套规则
→ 固定正文与附件快照
```

### QP-GEN-02 国家统计局国家数据

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [国家数据月度查询](https://data.stats.gov.cn/easyquery.htm?cn=A01)、国家统计局“数据/统计制度/统计标准”页面 |
| 查询方法 | 选择月度、季度或年度数据库；按指标树或关键词定位；导出时保留指标全名、地区、时间和单位；同时保存对应统计制度或指标解释 |
| 必录字段 | `database`、`indicator_name`、`region`、`period`、`frequency`、`unit`、`current_or_cumulative`、`yoy_or_mom`、`seasonal_adjustment`、`retrieved_at` |
| 口径边界 | 当月值、累计值、当月同比、累计同比不能混用；规模以上与全口径不能混用；产品产量不等于销售量或收入 |
| 同源替代 | 国家数据交互页 → 国家统计局月度公报/新闻稿附表 → 统计年鉴或历史数据库 |
| 跨源回退 | 工业细分缺失 → 对应部委运行公报 → 地方统计局作局部验证；不得把地方相加成全国值 |
| 失败上限 | 只有图表截图而无指标名、单位和业务期时记 `trace_missing`，不得进入正式测量 |

复现时优先保留原值，不让网站代算同比或频率转换；所有衍生值在本次任务中另算并保存公式。

### QP-GEN-03 中国海关统计

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [海关统计数据在线查询平台](https://stats.customs.gov.cn)、[海关总署](https://www.customs.gov.cn)统计快讯/数据在线查询说明 |
| 查询方法 | 先固定 HS 版本和代码层级，再选进出口、报告期、贸易伙伴、贸易方式、注册地或收发货人所在地；分别导出人民币/美元金额和法定第一/第二数量 |
| 必录字段 | `hs_version`、`commodity_code`、`commodity_name`、`flow`、`reporter`、`partner`、`period`、`trade_regime`、`quantity_unit_1/2`、`value_currency`、`current_or_cumulative` |
| 口径边界 | 海关商品编码不等于行业产品分类；金额不等于数量；出口目的地不一定是最终消费地；注册地不等于生产地 |
| 同源替代 | 在线查询 → 海关统计月报/快讯 → 海关统计年鉴；验证码或超时属于 `channel_error`，不改变来源身份 |
| 跨源回退 | 海关平台持续不可用 → UN Comtrade 的中国 reporter 数据 → 对方海关镜像数据；必须标记修订、FOB/CIF 和伙伴归属差异 |
| 失败上限 | HS 映射不唯一时，只能输出代码集合范围或方向性代理，不得声称精确产品规模 |

查询前先保存“商品名称—HS6—中国当年更细位编码—纳入/排除项”映射表；跨年查询必须检查编码是否拆分、合并或改名。

### QP-GEN-04 A 股法定披露

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [巨潮资讯公告查询](https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search)、[上交所](https://www.sse.com.cn)、[深交所](https://www.szse.cn)、[北交所](https://www.bse.cn) |
| 查询方法 | 用证券代码锁定主体，设置披露日期和公告类别；优先查定期报告、临时公告、问询函及回复、再融资/招股材料；标题关键词只作第二筛选 |
| 必录字段 | `security_code`、`issuer_legal_name`、`announcement_title`、`announcement_date`、`reporting_period`、`announcement_id_or_url`、`page_or_section`、`restatement_status` |
| 口径边界 | 证券简称可能变更；公告日不等于业务发生日；订单、中标、合同负债、发货、验收、收入和回款不能互换 |
| 同源替代 | 巨潮 PDF → 交易所同公告 → 公司 IR 镜像；以法定披露版本为主 |
| 跨源回退 | PDF 无法解析 → HTML/可视化财报用于定位并人工核对 PDF；数据库字段只用于复算，不替代公告 |
| 失败上限 | 只有公司新闻稿或互动问答时，最多作为管理层表述或线索 |

定期报告取数要同时检查：合并/母公司、报告期/上年同期、重述、币种单位、分部口径、审计意见和会计政策变化。

### QP-GEN-05 SEC EDGAR 披露与 XBRL

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [EDGAR Search](https://www.sec.gov/search-filings)、[EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) |
| 人工查询 | 公司名/ticker/CIK → form type → filing date/period of report → 打开 filing detail 和原始文件；全文检索用于找 risk factor、customer、inventory、capex 等词 |
| 结构化查询 | `https://data.sec.gov/submissions/CIK##########.json` 查 filing history；`https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` 查公司事实；CIK 补足 10 位 |
| 必录字段 | `cik`、`form`、`filing_date`、`period_of_report`、`accession_number`、`primary_document`、`taxonomy`、`tag`、`unit`、`start/end/instant`、`filed`、`frame` |
| 口径边界 | XBRL tag 不是经济含义本身；公司自定义 tag 与标准 tag 可能不一致；instant 与 duration 不能混用；财年季度不一定等于自然季度 |
| 同源替代 | API → filing HTML/inline XBRL → filing XBRL instance → SEC nightly bulk ZIP |
| 跨源回退 | EDGAR 暂时限流 → 稍后重试或使用已冻结 filing；公司 IR 只能临时定位，不替代 accession 对应文件 |
| 失败上限 | frames API 跨公司比较若日历期不匹配，只能作筛查，必须回到公司 filing 复核 |

自动访问须遵守 SEC 的公平访问要求，设置可识别的 User-Agent；批量任务优先使用 nightly bulk，不以高频轮询制造 `channel_error`。

### QP-GEN-06 港股披露

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [HKEXnews](https://www.hkexnews.hk) |
| 查询方法 | 选择“上市公司公告”并输入股份代号或公司名，固定发布日期范围与文件类别；年报/中报、公告、通函、招股书分别查询 |
| 必录字段 | `stock_code`、`issuer`、`document_type`、`publication_datetime_hkt`、`reporting_period`、`title`、`document_url`、`page_or_section` |
| 口径边界 | 公告发布时间为香港时间；A+H 公司需分别核对 A/H 披露；中文与英文不一致时按文件法律声明处理 |
| 同源替代 | HKEXnews PDF → 公司 IR 镜像；仍保留 HKEXnews locator |
| 跨源回退 | 搜索失败 → 用股份代号缩短日期范围 → 交易所 issuer page → 公司 IR 定位 |
| 失败上限 | 公司 IR 找到但 HKEXnews 无法复核时，只能暂存，待恢复后升级 |

### QP-GEN-07 FRED/ALFRED 宏观序列

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [FRED](https://fred.stlouisfed.org)、[FRED API 文档](https://fred.stlouisfed.org/docs/api/fred/series_observations.html) |
| 查询方法 | 先确认 `series_id` 和原始生产机构；API 使用 `api_key`、`series_id`、`observation_start/end`、`file_type`；研究预期和历史决策时设置 `vintage_dates` 或使用 ALFRED。密钥不写入证据快照 |
| 必录字段 | `series_id`、`source`、`release`、`frequency`、`units`、`seasonal_adjustment`、`observation_date`、`vintage_date`、`last_updated` |
| 口径边界 | FRED 常为聚合通道，原始生产者仍应保留；`units` 变换和 `frequency` 聚合是处理结果，不是原始值；当前修订值不能替代当时可得值 |
| 同源替代 | API → FRED 下载 CSV/XLSX → 原始发布机构表格 |
| 跨源回退 | FRED 无目标序列 → BLS/BEA/Federal Reserve/Treasury 等原始机构；不得用无来源宏观网站补位 |
| 失败上限 | 缺少 vintage 时不能用于“当时市场已知什么”的预期判断 |

### QP-GEN-08 BLS 与 BEA 原始美国宏观数据

| 项目 | BLS | BEA |
|---|---|---|
| 正式入口 | [BLS Public Data API](https://www.bls.gov/developers/) | [BEA API](https://apps.bea.gov/api/signup/) |
| 查询键 | `seriesid[]`、`startyear`、`endyear`；v1 可不注册但限额较低，v2 使用 registration key | `UserID`、`datasetname`、`TableName`/`LineCode`、`GeoFIPS`、`Year`、`ResultFormat`；密钥不写入证据快照 |
| 必录字段 | series ID、period、footnote、seasonality、base/reference period | dataset、table、line、unit、scale、geo、year、vintage |
| 主要口径风险 | 指数基期、季调、年化、初值/修订值 | nominal/real、SAAR/非年化、链式量、表版本 |
| 回退 | API → 官方表格/新闻稿 → FRED 镜像并保留原始机构 | API → Interactive Data 表格 → FRED 镜像并保留原始机构 |

新闻稿文字只用于解释发布，不替代表格值；初值、第二次估计、第三次估计和年度修订分别保存。

### QP-GEN-09 UN Comtrade 双边贸易

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [UN Comtrade Plus](https://comtradeplus.un.org)；批量或自动查询使用其官方 API/下载能力 |
| 查询方法 | 固定 `typeCode=C`、`freqCode=A/M`、`clCode=HS`，选择 period、reporterCode、partnerCode、cmdCode、flowCode；先用 preview 验证，再执行正式下载 |
| 必录字段 | `typeCode`、`freqCode`、`clCode`、`period`、`reporterCode`、`partnerCode`、`partner2Code`、`cmdCode`、`flowCode`、`qtyUnitCode`、`qty`、`netWgt`、`primaryValue`、`isAggregate` |
| 口径边界 | 报告国与伙伴国镜像值会因 FOB/CIF、时间、转口和归属不同而不一致；月度与年度值可能修订；HS 版本跨年会变化 |
| 同源替代 | API → Comtrade Plus 手工下载 → 官方 bulk file |
| 跨源回退 | reporter 缺报 → partner mirror → 报告国本国海关 → ITC Trade Map；必须保留镜像身份，不取简单平均 |
| 失败上限 | 只能取得 aggregate 或旧 HS 映射时，只能支持范围/方向，不能支撑精确产品暴露 |

### QP-GEN-10 公开市场行情

| 项目 | 操作要求 |
|---|---|
| 主源顺序 | 交易所/基准管理人 → 授权数据库 → 合规公开 API |
| 查询方法 | 固定 instrument ID、交易所、字段、时区、起止时间、频率、复权方式、币种和交易日历；事件研究保留未复权价格和公司行动表 |
| 必录字段 | `instrument_id`、`venue`、`field`、`timestamp`、`timezone`、`currency`、`adjustment`、`frequency`、`calendar`、`vendor` |
| 口径边界 | close、settlement、last、VWAP 不同；现货、期货、连续合约不同；总回报、价格回报和复权价不同 |
| 回退 | 交易所下载 → 授权数据库 → 第二公开行情；新闻中的涨跌幅只作线索 |
| 失败上限 | 缺少复权与公司行动信息时，不做跨期收益和事件窗口结论 |

## 4. 失败回退的四级路线

```text
L0 同一材料换通道
  HTML → PDF → API → bulk → 已冻结快照
L1 同一生产者换材料
  月报 → 季报 → 年报；交互表 → 发布附表
L2 换独立生产者但保持同一测量
  本国海关 → UN Comtrade reporter；交易所 → 授权数据库
L3 建受限代理
  直接测量不可得 → 校准代理 + A09 失效条件
```

只有 L0 通常不改变 SourceProfile。L1 要检查频率和业务时间，L2 要重评方法与独立性，L3 必须降低质量和结论上限。

## 5. 可复制的查询记录

```yaml
query_playbook_id: QP-GEN-00
source_name: ""
source_profile_id: ""
source_url: ""
query_parameters: {}
business_time: ""
publication_cutoff: ""
retrieved_at: ""
artifact_type: ""
access_scope: public
locator: ""
measure_definition: ""
unit_and_denominator: ""
classification_and_version: ""
revision_or_vintage: ""
actual_forecast_flag: actual
independence_group: ""
failure_code: null
fallback_level: L0
fallback_effect: ""
```

## 6. 停止规则

当主源材料、查询参数、业务时间、字段口径和版本已冻结，独立交叉源未发现不可解释冲突，且反证查询完成时停止。继续增加引用同一原始材料的新闻、研报和数据库转售字段，不增加独立证据强度。
