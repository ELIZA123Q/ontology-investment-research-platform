---
document_type: topic_evidence_source_query_playbook
schema_version: 1.0.0
file_id: B04-TOPIC-GEOPOLITICAL-OPS
updated_at: 2026-07-13
topic: geopolitical_shock
status: ready_to_use
verified_at: 2026-07-13
---

# B04-TOPIC-GEOPOLITICAL-OPS_地缘规则与冲击查询手册

## 1. 定位

本手册是 [B04 地缘冲击来源清单](B04-TOPIC-GEOPOLITICAL_地缘冲击取证来源清单.md) 的执行层。它把“制裁、出口管制、贸易、航道和能源来源”展开为可复核查询，并强制区分：

```text
名单命中
≠ 规则适用
≠ 许可被拒
≠ 实物流中断
≠ 公司财务影响
```

本手册服务投研取证，不构成法律或合规意见。涉及交易合规时，必须由有权人员依据最新正式文本复核。

## 2. 规则类材料统一字段

```text
jurisdiction
issuing_authority
action_type
document_title / document_number / FR_Doc_No
publication_date / effective_date
subject_name / aliases / address / unique_id
list_name / list_entry_date / list_update_date
item_scope / ECCN / HS / technology / software / service
end_user / end_use / destination
license_requirement / review_policy / license_exception
general_license / exemption / transition_period
amends / supersedes / corrected_by
retrieved_at / locator
```

规则查询必须同时检查正文、附件/清单、定义、适用范围、生效条款和后续修订。搜索结果和聚合名单只能用于发现。

## 3. 来源操作卡

### QP-GEO-01 中国出口管制与反制

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [中国出口管制信息网](https://exportcontrol.mofcom.gov.cn)、[商务部](https://www.mofcom.gov.cn)、[海关总署](https://www.customs.gov.cn)、[中国政府网](https://www.gov.cn) |
| 查询方法 | 在“政策法规、国内动态、常见问题、两用物项查询”分别检索物项名、公告号、主体和发布日期；打开公告正文、附件清单和 FAQ；再查许可、最终用户/最终用途、海关申报要求 |
| 必录字段 | `announcement_no`、`controlled_item`、`control_code_or_reference_hs`、`destination/end_user/end_use`、`effective_date`、`license`、`exception`、`customs_requirement` |
| 口径边界 | 参考海关商品编号不自动等于管制物项边界；管制、禁止、许可管理、不可靠实体和反制清单是不同法律动作 |
| 同源回退 | 出口管制信息网 → 商务部原公告/附件 → 中国政府网/海关执行说明 |
| 跨源回退 | 页面不可用 → 官方公报/答记者问定位；媒体或律所解读不能替代正文 |
| 失败上限 | 未核对附件、物项描述、生效和例外时，只能确认“发布了相关公告”，不能确认具体产品受控 |

### QP-GEO-02 美国 BIS Entity List 与 EAR

| 项目 | 操作要求 |
|---|---|
| 当前规则入口 | [BIS EAR Part 744](https://media.bis.gov/regulations/ear/744)、其中 Supplement No. 4 为 Entity List；[eCFR Title 15](https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C)用于交叉定位当前编纂文本 |
| 变更原文 | [Federal Register](https://www.federalregister.gov)或 [GovInfo Federal Register](https://www.govinfo.gov/help/fr)，按实体名、agency=BIS、日期或 FR Doc No. 查询新增、修改和移除规则 |
| 查询方法 | 先按主体名称/别名/地址查 Supplement No. 4；记录 country、license requirement、license review policy、Federal Register citation；再回到对应 Federal Register rule 查 effective date、ECCN/footnote、FDPR、savings clause 和 correction |
| 必录字段 | `entity_name`、`aliases`、`address`、`country`、`license_requirement`、`review_policy`、`footnote`、`fr_citation`、`effective_date`、`latest_amendment` |
| 口径边界 | Entity List 命中不等于所有交易全面禁止；每条 entry 的 license requirement 和 review policy 可能不同；规则还可能通过最终用途、最终用户、FDPR 或 Part 746 适用 |
| 同源回退 | BIS HTML → eCFR 当前文本 → Federal Register PDF/XML → GovInfo 正式版本 |
| 跨源回退 | ITA CSL 可筛查名称，但命中后必须回 BIS/Federal Register；律所简报只作解释 |
| 失败上限 | 只在聚合名单命中但未回规则正文时，不得确认法律适用范围 |

执行顺序：

```text
实体法定名 + 别名 + 地址
→ Entity List entry
→ license requirement / review policy / footnote
→ FR citation 与生效日
→ ECCN、最终用途/用户、FDPR、Part 746
→ savings clause、general license、FAQ/correction
→ 公司产品和交易暴露
```

### QP-GEO-03 美国 Consolidated Screening List

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [ITA Consolidated Screening List](https://www.trade.gov/consolidated-screening-list)、[ITA API portal](https://developer.trade.gov/apis) |
| 查询方法 | 人工搜索可启用 fuzzy name；自动查询/下载保留搜索词、score、source、source_information_url、addresses、alt_names 和下载日期 |
| 口径边界 | CSL 是 Commerce/State/Treasury 多名单的聚合筛查工具，只包含当前 active entities；不适合历史状态研究，也不是最终规则解释来源 |
| 同源回退 | Search UI → CSV/TSV/JSON download → CSL API |
| 跨源回退 | 按 `source` 回到 BIS、OFAC、State Department 或 Federal Register 原始名单 |
| 失败上限 | 模糊匹配只说明潜在命中；未核对唯一标识、地址、名单来源和原规则时不得确认是同一主体 |

历史研究不得用当前 CSL 反推过去状态；应使用当日 Federal Register、名单更新公告或已冻结历史清单。

### QP-GEO-04 OFAC 制裁名单

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [OFAC Sanctions List Search](https://ofac.treasury.gov/sanctions-list-search-tool)、[Sanctions List Service](https://ofac.treasury.gov/sanctions-list-service)、[Recent Actions](https://ofac.treasury.gov/recent-actions/sanctions-list-updates) |
| 查询方法 | 名称先 exact 再 fuzzy；核对 list、program、type、aliases、addresses、IDs 和 OFAC unique ID；打开对应 program page、Executive Order/法规、general license 和 FAQ |
| 必录字段 | `ofac_uid`、`list_name`、`program`、`name/aliases`、`address`、`id`、`listing_action_date`、`update_date`、`authority`、`general_license_or_exception` |
| 口径边界 | 名单命中不等于所有关联公司自动命中；所有权/控制、50 Percent Rule、交易类型和许可证必须另查；搜索分数不是合规结论 |
| 同源回退 | Search → SLS 数据文件 → Recent Actions/名单更新公告 |
| 跨源回退 | ITA CSL 用于发现；正式结论回 OFAC 数据与 program 规则 |
| 失败上限 | 只找到新闻中的“被制裁”时只能作事件线索 |

### QP-GEO-05 美国规则发布时间线

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [FederalRegister.gov](https://www.federalregister.gov)、[GovInfo API/Developer Hub](https://www.govinfo.gov/developers) |
| 查询方法 | 用 agency、term、document type、publication date；记录 FR Doc No.、volume、page、RIN、CFR parts affected；自动化可用 GovInfo API/bulk，保存 API key 之外的全部参数 |
| 必录字段 | `fr_doc_no`、`agency`、`document_type`、`publication_date`、`effective_date`、`cfr_parts`、`rin`、`correction_or_amendment` |
| 口径边界 | proposed rule、interim final rule、final rule、notice、correction 不同；publication date 与 effective date 不同；当前 eCFR 不能还原历史时点 |
| 同源回退 | FederalRegister HTML → GovInfo PDF/XML → 当日整期 Federal Register |
| 跨源回退 | BIS/OFAC agency page 的 rule link；仍需保存 FR/GovInfo locator |
| 失败上限 | 缺少 effective date 或 correction 检查时，不得断言某日规则已适用 |

### QP-GEO-06 双边贸易与产品暴露

| 项目 | 操作要求 |
|---|---|
| 主源 | 报告国海关、[UN Comtrade Plus](https://comtradeplus.un.org)、美国问题可加 USITC DataWeb |
| 查询方法 | 固定 reporter、partner、flow、HS version/code、period、数量/净重、primary value；政策前后使用同一代码和贸易制度；检查 partner mirror |
| 必录字段 | `reporter`、`partner`、`flow`、`hs_version`、`cmd_code`、`period`、`qty_unit`、`qty/net_weight`、`primary_value`、`mirror_flag`、`revision` |
| 口径边界 | 贸易流量不是公司暴露；伙伴国可能是转口地；金额受价格和汇率影响；数量单位可能因商品变化 |
| 回退 | 本国海关 → Comtrade reporter → partner mirror → ITC Trade Map；镜像差异作为证据冲突保留 |
| 失败上限 | 无法将 HS 与受控物项可靠映射时，只能输出潜在暴露范围 |

### QP-GEO-07 航道事实与海上安全

| 项目 | 操作要求 |
|---|---|
| 事件主源 | 当事国海事/港口机关、[UKMTO](https://www.ukmto.org)、IMO/船公司正式公告、中国海事局/地方海事局 |
| 结构背景 | [EIA World Oil Transit Chokepoints](https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/) |
| 查询方法 | 事件按 incident/advisory number、UTC 时间、坐标、船型、状态查询；结构数据记录 chokepoint、period、million b/d 或 Bcf/d、数据来源和估算方法 |
| 必录字段 | `incident_id`、`event_time_utc`、`published_time`、`location/coordinates`、`vessel_type`、`status`、`route`、`physical_disruption`、`source_update` |
| 口径边界 | 安全通告不等于航道关闭；航道结构流量不等于当期中断量；绕行、延迟、保险和实际货损分别测量 |
| 回退 | 官方 incident/advisory → 船公司/港口公告 → Reuters/AP 等定位 → AIS/OSINT 只作受限验证 |
| 失败上限 | 只有社媒视频或匿名消息时，事件状态停留在 `report` |

### QP-GEO-08 上海出口集装箱运价指数

| 项目 | 操作要求 |
|---|---|
| 正式入口 | [SCFI 查询](https://www.sse.net.cn/index/singleIndex?indexType=scfi)、[CCFI 查询](https://www.sse.net.cn/index/singleIndex?indexType=ccfi)、[指数说明](https://en.sse.net.cn/indices/intro_scfitt.htm) |
| 查询方法 | 按指数发布日期查询，保存综合指数与目标航线；记录发布主体、航线、base ports、箱型、单位、基期、费率包含项和数据授权范围 |
| SCFI 口径 | 上海出口即期市场，分航线费率；欧洲等常见为 USD/TEU，美西/美东为 USD/FEU；普通干货箱，CY—CY；具体附加费以现行编制规则为准 |
| CCFI 口径 | 中国出口集装箱市场指数，覆盖不同航线和样本；不能与 SCFI 点位或费率直接拼接 |
| 变更提示 | 2026-06-18 起 SCFI、CCFI、SCFIS 等 7 项集装箱指数编制发布主体调整为上海航运交易研究所（筹）；取证要记录发布主体和变更日 |
| 回退 | 官方查询页 → 官方周报/公告 → 授权数据库镜像；历史数据受权限限制时记 `access_denied` |
| 失败上限 | 综合指数只能说明总体运价环境，不能替代公司实际航线、合同价、箱型和物流成本 |

### QP-GEO-09 能源价格、实物流与库存

| 测量 | 主源 | 必须固定 |
|---|---|---|
| 原油期货 | ICE Brent、CME/NYMEX WTI、授权行情 | contract、expiry、settlement/close、currency、timezone、continuous roll |
| 原油现货/评估价 | EIA、Argus、S&P Global Commodity Insights 等 | grade、location、assessment window、methodology、license |
| 产量与库存 | EIA、IEA、OPEC、JODI、国家能源机构 | product、geography、period、unit、estimate/reported、revision |
| 航道流量 | EIA chokepoints、专业船舶跟踪 | route、cargo、period、unit、estimated coverage |

价格跳升只能证明市场定价；实际中断至少还需产量、出口、库存、船舶/港口或公司交付证据。主源数据滞后时可以用市场价作领先信号，但不能回填为实物流事实。

## 4. 从规则到影响的五道门

| 门 | 最低证据 | 未通过时的停止位置 |
|---|---|---|
| G1 正式动作 | 正文/名单/公告、生效日、适用机关 | 只能写传闻/报道 |
| G2 范围匹配 | 主体、别名、地址、物项、ECCN/HS、最终用途/用户 | 只能写潜在相关 |
| G3 真实暴露 | 公司产品、客户/供应商、地区收入/采购、交易关系 | 只能写条件性暴露 |
| G4 物理或经营结果 | 贸易量、许可、交期、价格、库存、订单、产量 | 不能写影响已经发生 |
| G5 财务与定价 | 量价成本、公司财务、市场预期和反证 | 不能写财务利好/利空强度 |

## 5. 失败替代矩阵

| 任务 | 主源失败 | 第一替代 | 第二替代 | 降级效果 |
|---|---|---|---|---|
| 中国管制规则 | 官网页面故障 | 同机关公告/中国政府网 | 官方公报/海关执行说明 | 不用媒体替代附件 |
| BIS 规则 | BIS 页面故障 | eCFR | Federal Register/GovInfo | 当前编纂与历史生效日分开 |
| 名单筛查 | API/搜索故障 | 官方下载文件 | 原始名单页面 | 聚合名单仍需回规则 |
| OFAC 名单 | Search 故障 | SLS 数据文件 | Recent Actions/更新公告 | 需核对 program 和 authority |
| 贸易流 | reporter 缺报 | partner mirror | 另一官方海关 | 保留镜像差异，不平均 |
| 航道事件 | 单方通报缺失 | 船公司/港口/UKMTO | 权威新闻 + AIS 受限验证 | 未交叉则停在 report |
| 运价 | 历史授权不可得 | 官方周报/最新指数 | 授权数据库 | 不能伪造历史序列 |
| 实物流 | 发布滞后 | 公司/港口/船舶数据 | 价格与运价领先信号 | 领先信号不等于中断事实 |

## 6. 高频更新与版本规则

1. 名单、许可证、豁免、general license、FAQ 和 correction 均可能改变适用状态；每次运行固定 `publication_cutoff` 和 `retrieved_at`。
2. 当前清单不得覆盖历史快照；新增、修改、移除分别形成事件。
3. 实体别名和地址匹配结果要保存原始搜索词与匹配分数，不能只留“命中/未命中”。
4. 航运和能源数据同时保存事件时间、发布时间和数据覆盖期，避免把滞后数据当实时状态。
5. 页面或 API 变化优先按 `channel_error` 处理；只有生产者、方法或内容域改变时才换 SourceProfile。

## 7. 停止规则

若只能确认 G1/G2，应停止在规则事实或条件性暴露，不用更多新闻拼成 G3—G5。只有正式动作、范围匹配、实际暴露、结果变量与反证都完成，才进入方向性影响判断；财务强度还需量价成本和时间窗口测算。
