# OPS 地缘规则与冲击查询手册

最近复核：2026-07-13。适用范围：制裁、出口管制、贸易、航道与能源冲击的真实查询入口、口径陷阱与回退。

## 0. 写入长期手册与从手册拿掉

仅收录满足 [B00 OPS 准入](B00_来源选择与使用边界.md) 的地缘高频来源。每张卡必须有唯一查询编号（`QP-GEO-*`）、正式入口、口径边界、回退路线与复核日期。单次临时入口不写入长期手册；失效条目从手册拿掉后，不得继续被 B 速查表引用。

## 1. 定位

本手册是地缘规则与冲击的执行层，来源角色和使用边界见 [B00](B00_来源选择与使用边界.md)，通用政策、贸易和市场入口见 [B01](B01_通用来源速查.md)。它把「制裁、出口管制、贸易、航道和能源来源」展开为可复核查询，并强制区分：

```text
名单命中
≠ 规则适用
≠ 许可被拒
≠ 实物流中断
≠ 公司财务影响
```

本手册服务投研取证，不构成法律或合规意见。涉及交易合规时，必须由有权人员依据最新正式文本复核。

## 2. 规则类材料：查询前先写清

| 中文 | 记下什么 |
|---|---|
| 法域与发布机关 | 谁发布、适用哪套规则 |
| 动作类型 | 管制、制裁、许可、豁免、修订等 |
| 文件定位 | 标题、文号、联邦公报编号等 |
| 发布日／生效日 | 不得混写 |
| 主体 | 名称、别名、地址、唯一 ID |
| 名单信息 | 名单名、列入日、更新日期 |
| 物项范围 | ECCN／HS／技术／软件／服务 |
| 最终用户／用途／目的地 | 适用范围 |
| 许可要求 | 审查政策、一般许可、豁免、过渡期 |
| 修订关系 | 修订／废止／更正 |
| 取数时间与定位 | 何时取得、原文在哪里 |

参数模板：

```text
jurisdiction, issuing_authority, action_type,
document_title / document_number / FR_Doc_No,
publication_date / effective_date,
subject_name / aliases / address / unique_id,
list_name / list_entry_date / list_update_date,
item_scope / ECCN / HS / technology / software / service,
end_user / end_use / destination,
license_requirement / review_policy / license_exception,
general_license / exemption / transition_period,
amends / supersedes / corrected_by,
retrieved_at / locator
```

规则查询必须同时检查正文、附件／清单、定义、适用范围、生效条款和后续修订。搜索结果和聚合名单只能用于发现。

## 3. 来源操作卡

### 中国出口管制与反制（QP-GEO-01）

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [中国出口管制信息网](https://exportcontrol.mofcom.gov.cn)、[商务部](https://www.mofcom.gov.cn)、[海关总署](https://www.customs.gov.cn)、[中国政府网](https://www.gov.cn) |
| 查询方法 | 在「政策法规、国内动态、常见问题、两用物项查询」分别检索物项名、公告号、主体和发布日期；打开公告正文、附件清单和 FAQ；再查许可、最终用户／最终用途、海关申报要求 |
| 取得后记下 | 公告号、受控物项、管制代码或参考海关编码、目的地／最终用户／最终用途、生效日、许可、例外、海关要求 |
| 口径边界 | 参考海关商品编号不自动等于管制物项边界；管制、禁止、许可管理、不可靠实体和反制清单是不同法律动作 |
| 同源回退 | 出口管制信息网 → 商务部原公告／附件 → 中国政府网／海关执行说明 |
| 跨源回退 | 页面不可用 → 官方公报／答记者问定位；媒体或律所解读不能替代正文 |
| 取不到时 | 未核对附件、物项描述、生效和例外时，只能确认「发布了相关公告」，不能确认具体产品受控 |

参数模板：

```text
announcement_no, controlled_item, control_code_or_reference_hs,
destination/end_user/end_use, effective_date, license, exception, customs_requirement
```

### 美国 BIS Entity List 与 EAR（QP-GEO-02）

| 项目 | 操作要求 |
|---|---|
| 当前规则入口 | [BIS EAR Part 744](https://media.bis.gov/regulations/ear/744)、其中 Supplement No. 4 为 Entity List；[eCFR Title 15](https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C) 用于交叉定位当前编纂文本 |
| 变更原文 | [Federal Register](https://www.federalregister.gov) 或 [GovInfo Federal Register](https://www.govinfo.gov/help/fr)，按实体名、agency=BIS、日期或 FR Doc No. 查询新增、修改和移除规则 |
| 查询方法 | 先按主体名称／别名／地址查 Supplement No. 4；记录国家、许可要求、审查政策、联邦公报引用；再回到对应联邦公报规则查生效日、ECCN／脚注、FDPR、过渡条款和更正 |
| 取得后记下 | 实体名、别名、地址、国家、许可要求、审查政策、脚注、联邦公报引用、生效日、最新修订 |
| 口径边界 | Entity List 命中不等于所有交易全面禁止；每条条目的许可要求和审查政策可能不同；规则还可能通过最终用途、最终用户、FDPR 或 Part 746 适用 |
| 同源回退 | BIS 网页 → eCFR 当前文本 → 联邦公报 PDF／XML → GovInfo 正式版本 |
| 跨源回退 | ITA CSL 可筛查名称，但命中后必须回 BIS／联邦公报；律所简报只作解释 |
| 取不到时 | 只在聚合名单命中但未回规则正文时，不得确认法律适用范围 |

执行顺序：

```text
实体法定名 + 别名 + 地址
→ Entity List 条目
→ 许可要求／审查政策／脚注
→ 联邦公报引用与生效日
→ ECCN、最终用途／用户、FDPR、Part 746
→ 过渡条款、一般许可、FAQ／更正
→ 公司产品和交易暴露
```

参数模板：

```text
entity_name, aliases, address, country, license_requirement,
review_policy, footnote, fr_citation, effective_date, latest_amendment
```

### 美国 Consolidated Screening List（QP-GEO-03）

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [ITA Consolidated Screening List](https://www.trade.gov/consolidated-screening-list)、[ITA API portal](https://developer.trade.gov/apis) |
| 查询方法 | 人工搜索可启用模糊名称；自动查询／下载保留搜索词、分数、来源、来源链接、地址、别名和下载日期 |
| 口径边界 | CSL 是商务／国务院／财政部多名单的聚合筛查工具，只包含当前有效主体；不适合历史状态研究，也不是最终规则解释来源 |
| 同源回退 | 搜索界面 → CSV／TSV／JSON 下载 → CSL 接口 |
| 跨源回退 | 按来源回到 BIS、OFAC、国务院或联邦公报原始名单 |
| 取不到时 | 模糊匹配只说明潜在命中；未核对唯一标识、地址、名单来源和原规则时不得确认是同一主体 |

历史研究不得用当前 CSL 反推过去状态；应使用当日联邦公报、名单更新公告或已冻结历史清单。

### OFAC 制裁名单（QP-GEO-04）

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [OFAC Sanctions List Search](https://ofac.treasury.gov/sanctions-list-search-tool)、[Sanctions List Service](https://ofac.treasury.gov/sanctions-list-service)、[Recent Actions](https://ofac.treasury.gov/recent-actions/sanctions-list-updates) |
| 查询方法 | 名称先精确再模糊；核对名单、项目、类型、别名、地址、证件号和 OFAC 唯一 ID；打开对应项目页、行政令／法规、一般许可和 FAQ |
| 取得后记下 | OFAC 唯一 ID、名单名、项目、名称／别名、地址、证件号、列入动作日、更新日期、机关、一般许可或例外 |
| 口径边界 | 名单命中不等于所有关联公司自动命中；所有权／控制、50% 规则、交易类型和许可证必须另查；搜索分数不是合规结论 |
| 同源回退 | 搜索 → SLS 数据文件 → Recent Actions／名单更新公告 |
| 跨源回退 | ITA CSL 用于发现；正式结论回 OFAC 数据与项目规则 |
| 取不到时 | 只找到新闻中的「被制裁」时只能作事件线索 |

参数模板：

```text
ofac_uid, list_name, program, name/aliases, address, id,
listing_action_date, update_date, authority, general_license_or_exception
```

### 美国规则发布时间线（QP-GEO-05）

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [FederalRegister.gov](https://www.federalregister.gov)、[GovInfo API／Developer Hub](https://www.govinfo.gov/developers) |
| 查询方法 | 用机关、关键词、文件类型、发布日期；记录 FR Doc No.、卷、页、RIN、受影响 CFR 部分；自动化可用 GovInfo 接口／批量，保存密钥之外的全部参数 |
| 取得后记下 | 联邦公报编号、机关、文件类型、发布日、生效日、CFR 部分、RIN、更正或修订 |
| 口径边界 | 拟议规则、临时最终规则、最终规则、通知、更正不同；发布日与生效日不同；当前 eCFR 不能还原历史时点 |
| 同源回退 | FederalRegister 网页 → GovInfo PDF／XML → 当日整期联邦公报 |
| 跨源回退 | BIS／OFAC 机关页的规则链接；仍需保存 FR／GovInfo 定位 |
| 取不到时 | 缺少生效日或更正检查时，不得断言某日规则已适用 |

参数模板：

```text
fr_doc_no, agency, document_type, publication_date, effective_date,
cfr_parts, rin, correction_or_amendment
```

### 双边贸易与产品暴露（QP-GEO-06）

| 项目 | 操作要求 |
|---|---|
| 主源 | 报告国海关、[UN Comtrade Plus](https://comtradeplus.un.org)、美国问题可加 USITC DataWeb |
| 查询方法 | 固定报告国、伙伴、流向、HS 版本／代码、期间、数量／净重、金额；政策前后使用同一代码和贸易制度；检查伙伴镜像 |
| 取得后记下 | 报告国、伙伴、流向、HS 版本、商品代码、期间、数量单位、数量／净重、金额、是否镜像、修订 |
| 口径边界 | 贸易流量不是公司暴露；伙伴国可能是转口地；金额受价格和汇率影响；数量单位可能因商品变化 |
| 回退 | 本国海关 → Comtrade 报告国 → 伙伴镜像 → ITC Trade Map；镜像差异作为证据冲突保留 |
| 取不到时 | 无法将 HS 与受控物项可靠映射时，只能输出潜在暴露范围 |

参数模板：

```text
reporter, partner, flow, hs_version, cmd_code, period,
qty_unit, qty/net_weight, primary_value, mirror_flag, revision
```

### 航道事实与海上安全（QP-GEO-07）

| 项目 | 操作要求 |
|---|---|
| 事件主源 | 当事国海事／港口机关、[UKMTO](https://www.ukmto.org)、IMO／船公司正式公告、中国海事局／地方海事局 |
| 结构背景 | [EIA World Oil Transit Chokepoints](https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/) |
| 查询方法 | 事件按事件／通告编号、UTC 时间、坐标、船型、状态查询；结构数据记录咽喉点、期间、百万桶／日或 Bcf／日、数据来源和估算方法 |
| 取得后记下 | 事件编号、事件时间（UTC）、发布时间、位置／坐标、船型、状态、航线、是否物理中断、来源更新 |
| 口径边界 | 安全通告不等于航道关闭；航道结构流量不等于当期中断量；绕行、延迟、保险和实际货损分别测量 |
| 回退 | 官方事件／通告 → 船公司／港口公告 → Reuters／AP 等定位 → AIS／开源情报只作受限验证 |
| 取不到时 | 只有社媒视频或匿名消息时，事件状态停留在「报道层面」 |

参数模板：

```text
incident_id, event_time_utc, published_time, location/coordinates,
vessel_type, status, route, physical_disruption, source_update
```

### 上海出口集装箱运价指数（QP-GEO-08）

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [SCFI 查询](https://www.sse.net.cn/index/singleIndex?indexType=scfi)、[CCFI 查询](https://www.sse.net.cn/index/singleIndex?indexType=ccfi)、[指数说明](https://en.sse.net.cn/indices/intro_scfitt.htm) |
| 查询方法 | 按指数发布日期查询，保存综合指数与目标航线；记录发布主体、航线、基准港、箱型、单位、基期、费率包含项和数据授权范围 |
| SCFI 口径 | 上海出口即期市场，分航线费率；欧洲等常见为美元／TEU，美西／美东为美元／FEU；普通干货箱，CY—CY；具体附加费以现行编制规则为准 |
| CCFI 口径 | 中国出口集装箱市场指数，覆盖不同航线和样本；不能与 SCFI 点位或费率直接拼接 |
| 变更提示 | 2026-06-18 起 SCFI、CCFI、SCFIS 等 7 项集装箱指数编制发布主体调整为上海航运交易研究所（筹）；取证要记录发布主体和变更日 |
| 回退 | 官方查询页 → 官方周报／公告 → 授权数据库镜像；历史数据受权限限制时记「无权限」 |
| 取不到时 | 综合指数只能说明总体运价环境，不能替代公司实际航线、合同价、箱型和物流成本 |

### 能源价格、实物流与库存（QP-GEO-09）

| 测量 | 主源 | 必须固定 |
|---|---|---|
| 原油期货 | ICE Brent、CME／NYMEX WTI、授权行情 | 合约、到期、结算／收盘、币种、时区、连续合约滚动方式 |
| 原油现货／评估价 | EIA、Argus、S&P Global Commodity Insights 等 | 品级、地点、评估窗口、方法、授权 |
| 产量与库存 | EIA、IEA、OPEC、JODI、国家能源机构 | 产品、地理、期间、单位、估算／报告、修订 |
| 航道流量 | EIA 咽喉点、专业船舶跟踪 | 航线、货种、期间、单位、估算覆盖 |

价格跳升只能证明市场定价；实际中断至少还需产量、出口、库存、船舶／港口或公司交付证据。主源数据滞后时可以用市场价作领先信号，但不能回填为实物流事实。

## 4. 从规则到影响要过的五步核对

| 步骤 | 最低证据 | 未过时停在哪里 |
|---|---|---|
| 1. 正式动作 | 正文／名单／公告、生效日、适用机关 | 只能写传闻／报道 |
| 2. 范围匹配 | 主体、别名、地址、物项、ECCN／HS、最终用途／用户 | 只能写潜在相关 |
| 3. 真实暴露 | 公司产品、客户／供应商、地区收入／采购、交易关系 | 只能写条件性暴露 |
| 4. 物理或经营结果 | 贸易量、许可、交期、价格、库存、订单、产量 | 不能写影响已经发生 |
| 5. 财务与定价 | 量价成本、公司财务、市场预期和反证 | 不能写财务利好／利空强度 |

## 5. 主源失败替代路线

| 任务 | 主源失败 | 第一替代 | 第二替代 | 降级效果 |
|---|---|---|---|---|
| 中国管制规则 | 官网页面故障 | 同机关公告／中国政府网 | 官方公报／海关执行说明 | 不用媒体替代附件 |
| BIS 规则 | BIS 页面故障 | eCFR | 联邦公报／GovInfo | 当前编纂与历史生效日分开 |
| 名单筛查 | 接口／搜索故障 | 官方下载文件 | 原始名单页面 | 聚合名单仍需回规则 |
| OFAC 名单 | 搜索故障 | SLS 数据文件 | Recent Actions／更新公告 | 需核对项目和机关 |
| 贸易流 | 报告国缺报 | 伙伴镜像 | 另一官方海关 | 保留镜像差异，不平均 |
| 航道事件 | 单方通报缺失 | 船公司／港口／UKMTO | 权威新闻 + AIS 受限验证 | 未交叉则停在报道层面 |
| 运价 | 历史授权不可得 | 官方周报／最新指数 | 授权数据库 | 不能伪造历史序列 |
| 实物流 | 发布滞后 | 公司／港口／船舶数据 | 价格与运价领先信号 | 领先信号不等于中断事实 |

## 6. 高频更新与版本规则

1. 名单、许可证、豁免、一般许可、FAQ 和更正均可能改变适用状态；每次运行固定信息披露截止日和取数时间。
2. 当前清单不得覆盖历史快照；新增、修改、移除分别形成事件。
3. 实体别名和地址匹配结果要保存原始搜索词与匹配分数，不能只留「命中／未命中」。
4. 航运和能源数据同时保存事件时间、发布时间和数据覆盖期，避免把滞后数据当实时状态。
5. 页面或接口变化优先按「通道故障」处理；只有生产者、方法或内容域改变时才换来源身份。

## 7. 停止规则

若只能确认正式动作或范围匹配，应停止在规则事实或条件性暴露，不用更多新闻拼成暴露、结果与财务影响。只有正式动作、范围匹配、实际暴露、结果变量与反证都完成，才进入方向性影响判断；财务强度还需量价成本和时间窗口测算。

## 系统归档对照

| 英文码 | 中文含义 | 默认动作 |
|---|---|---|
| `channel_error` | 通道故障 | 同来源换通道，保留来源身份 |
| `access_denied` | 无权限 | 按预设回退；明确缺失粒度 |
| `trace_missing` | 找不到原文／无法追溯 | 回源；失败则不进入正式证据 |
| `scope_mismatch` | 对象／范围错位 | 不计入当前测量，重查分项 |
| `time_mismatch` | 时间错位 | 建时间桥接，不用未来信息回填 |
| `method_opaque` | 方法不透明 | 只作交叉线索 |
| `field_unavailable` | 字段不可得 | 查附录／替代材料 |
