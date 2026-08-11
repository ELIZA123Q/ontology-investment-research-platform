// Generated from 03_agent_capability/02_skills/evidence_research/references/public_evidence_sources.json. Do not edit.
export const EVIDENCE_SOURCE_CATALOG = {
  "schemaVersion": "1.0.0",
  "reviewedAt": "2026-08-11",
  "policy": {
    "channelIsNotSource": true,
    "freeDoesNotMeanFormal": true,
    "searchAndAiAreDiscoveryOnly": true,
    "formalUseRequiresUpstreamProducerAndFrozenSnapshot": true
  },
  "sources": [
    {
      "id": "nbs_china_official_web",
      "name": "国家统计局",
      "producerDomain": "stats.gov.cn",
      "authorityClass": "government_statistics",
      "sourceRole": "primary_producer",
      "sourceTier": "S1",
      "geographies": [
        "CN"
      ],
      "subjects": [
        "macro",
        "industry",
        "semiconductor_production",
        "prices",
        "profits"
      ],
      "admissionStatus": "active",
      "evidenceUse": "formal_fact",
      "channels": [
        {
          "kind": "official_web",
          "endpoint": "https://www.stats.gov.cn/sj/",
          "cost": "free",
          "auth": "none",
          "status": "live"
        },
        {
          "kind": "official_database",
          "endpoint": "https://data.stats.gov.cn/",
          "cost": "free",
          "auth": "none",
          "status": "pilot"
        }
      ],
      "licenseBoundary": "公开研究引用；保留原始页面、发布时间、统计范围和方法附注",
      "qualityNotes": [
        "规模以上口径不是全行业",
        "企业范围和历史同比口径可能调整"
      ]
    },
    {
      "id": "miit_china_official_web",
      "name": "工业和信息化部",
      "producerDomain": "miit.gov.cn",
      "authorityClass": "government_statistics",
      "sourceRole": "primary_producer",
      "sourceTier": "S1",
      "geographies": [
        "CN"
      ],
      "subjects": [
        "industry",
        "semiconductor_production",
        "electronics",
        "policy"
      ],
      "admissionStatus": "active",
      "evidenceUse": "formal_fact",
      "channels": [
        {
          "kind": "official_web",
          "endpoint": "https://www.miit.gov.cn/jgsj/",
          "cost": "free",
          "auth": "none",
          "status": "live"
        }
      ],
      "licenseBoundary": "公开研究引用；冻结原文和口径",
      "qualityNotes": [
        "行业运行稿可能引用其他统计生产者，需保留上游身份"
      ]
    },
    {
      "id": "cninfo_official_disclosure",
      "name": "巨潮资讯网",
      "producerDomain": "cninfo.com.cn",
      "authorityClass": "statutory_disclosure_platform",
      "sourceRole": "primary_producer",
      "sourceTier": "S1",
      "geographies": [
        "CN"
      ],
      "subjects": [
        "company_filings",
        "financial_statements",
        "events",
        "governance"
      ],
      "admissionStatus": "active",
      "evidenceUse": "formal_fact",
      "channels": [
        {
          "kind": "official_web_pdf",
          "endpoint": "https://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice",
          "cost": "free",
          "auth": "none",
          "status": "live"
        }
      ],
      "licenseBoundary": "法定披露公开阅读；保存公告ID、PDF哈希、页码和逐字摘录",
      "qualityNotes": [
        "平台是通道，事实责任主体仍是上市公司或披露义务人"
      ]
    },
    {
      "id": "sse_official_disclosure",
      "name": "上海证券交易所",
      "producerDomain": "sse.com.cn",
      "authorityClass": "exchange_disclosure_platform",
      "sourceRole": "primary_producer",
      "sourceTier": "S1",
      "geographies": [
        "CN"
      ],
      "subjects": [
        "company_filings",
        "market_rules",
        "events"
      ],
      "admissionStatus": "active",
      "evidenceUse": "formal_fact",
      "channels": [
        {
          "kind": "official_web_pdf",
          "endpoint": "https://www.sse.com.cn/disclosure/listedinfo/announcement/",
          "cost": "free",
          "auth": "none",
          "status": "live"
        }
      ],
      "licenseBoundary": "公开披露引用；保存公司、公告号、时间、PDF哈希和页码",
      "qualityNotes": [
        "公司事实与交易所规则需区分实际生产者"
      ]
    },
    {
      "id": "szse_official_disclosure",
      "name": "深圳证券交易所",
      "producerDomain": "szse.cn",
      "authorityClass": "exchange_disclosure_platform",
      "sourceRole": "primary_producer",
      "sourceTier": "S1",
      "geographies": [
        "CN"
      ],
      "subjects": [
        "company_filings",
        "market_rules",
        "events"
      ],
      "admissionStatus": "active",
      "evidenceUse": "formal_fact",
      "channels": [
        {
          "kind": "official_web_pdf",
          "endpoint": "https://www.szse.cn/disclosure/notice/company/",
          "cost": "free",
          "auth": "none",
          "status": "live"
        }
      ],
      "licenseBoundary": "公开披露引用；保存公司、公告号、时间、PDF哈希和页码",
      "qualityNotes": [
        "交易所通知与上市公司公告不能混为同一生产者"
      ]
    },
    {
      "id": "sec_edgar_official_api",
      "name": "SEC EDGAR",
      "producerDomain": "sec.gov",
      "authorityClass": "regulator_api",
      "sourceRole": "primary_producer",
      "sourceTier": "S1",
      "geographies": [
        "US"
      ],
      "subjects": [
        "company_filings",
        "xbrl_financials",
        "events"
      ],
      "admissionStatus": "active",
      "evidenceUse": "formal_fact",
      "channels": [
        {
          "kind": "official_api",
          "endpoint": "https://data.sec.gov/",
          "cost": "free",
          "auth": "none",
          "status": "live"
        }
      ],
      "licenseBoundary": "遵守 SEC automated access policy 与 User-Agent 要求",
      "qualityNotes": [
        "XBRL frame 需处理财年、单位和修订",
        "聚合 frame 不是单一公司原文"
      ]
    },
    {
      "id": "world_bank_indicators_api",
      "name": "World Bank Indicators API",
      "producerDomain": "worldbank.org",
      "authorityClass": "official_multilateral_api",
      "sourceRole": "direct_measurement",
      "sourceTier": "S3",
      "geographies": [
        "GLOBAL"
      ],
      "subjects": [
        "macro",
        "development",
        "trade",
        "demographics"
      ],
      "admissionStatus": "active",
      "evidenceUse": "formal_measurement",
      "channels": [
        {
          "kind": "official_api",
          "endpoint": "https://api.worldbank.org/v2/",
          "cost": "free",
          "auth": "none",
          "status": "live"
        }
      ],
      "licenseBoundary": "保留数据库、指标代码、来源组织和 source note",
      "qualityNotes": [
        "不同指标可能来自成员国或第三方，必须解析 Source Organization"
      ]
    },
    {
      "id": "fred_official_api",
      "name": "FRED/ALFRED API",
      "producerDomain": "stlouisfed.org",
      "authorityClass": "official_data_aggregator",
      "sourceRole": "direct_measurement",
      "sourceTier": "S3",
      "geographies": [
        "US",
        "GLOBAL"
      ],
      "subjects": [
        "macro",
        "rates",
        "labor",
        "prices",
        "revisions"
      ],
      "admissionStatus": "conditional",
      "evidenceUse": "formal_measurement",
      "channels": [
        {
          "kind": "official_api",
          "endpoint": "https://api.stlouisfed.org/fred/",
          "cost": "free",
          "auth": "free_api_key",
          "status": "live"
        }
      ],
      "licenseBoundary": "逐序列检查版权说明；应用展示 FRED 非背书声明",
      "qualityNotes": [
        "FRED 是汇集通道，独立来源组按原始 series source 归并",
        "正式时点研究优先使用 ALFRED vintage"
      ]
    },
    {
      "id": "openbb_mcp_transport",
      "name": "OpenBB MCP Server",
      "producerDomain": "openbb.co",
      "authorityClass": "transport_aggregator",
      "sourceRole": "discovery_only",
      "sourceTier": "S8",
      "geographies": [
        "GLOBAL"
      ],
      "subjects": [
        "market",
        "fundamentals",
        "macro",
        "discovery"
      ],
      "admissionStatus": "conditional",
      "evidenceUse": "discovery_only",
      "channels": [
        {
          "kind": "local_mcp",
          "endpoint": "openbb-mcp",
          "cost": "open_source",
          "auth": "provider_specific",
          "status": "candidate"
        }
      ],
      "licenseBoundary": "MCP 软件免费不等于底层数据免费；每个 provider 单独审查授权",
      "qualityNotes": [
        "OpenBB 只提供统一传输，不能作为发布主体",
        "只有解析到可信上游并冻结原始响应后才能晋级"
      ]
    },
    {
      "id": "keyvex_public_mcp",
      "name": "KeyVex Public MCP",
      "producerDomain": "keyvex.com",
      "authorityClass": "secondary_normalizer",
      "sourceRole": "professional_research",
      "sourceTier": "S4",
      "geographies": [
        "US"
      ],
      "subjects": [
        "sec_filings",
        "government_disclosures",
        "sanctions",
        "contracts",
        "macro"
      ],
      "admissionStatus": "pilot",
      "evidenceUse": "corroboration_only",
      "channels": [
        {
          "kind": "public_mcp",
          "endpoint": "https://mcp.keyvex.com",
          "cost": "free_rate_limited",
          "auth": "none",
          "status": "candidate"
        }
      ],
      "licenseBoundary": "仅作政府公开数据的发现和交叉核对；正式事实回到政府原文或验证其字段血缘",
      "qualityNotes": [
        "第三方标准化层不是政府发布主体",
        "上线前验证工具清单、限流、条款和原始记录链接"
      ]
    },
    {
      "id": "financial_datasets_mcp",
      "name": "Financial Datasets MCP",
      "producerDomain": "financialdatasets.ai",
      "authorityClass": "commercial_aggregator",
      "sourceRole": "professional_research",
      "sourceTier": "S4",
      "geographies": [
        "US"
      ],
      "subjects": [
        "financials",
        "sec_filings",
        "prices",
        "news"
      ],
      "admissionStatus": "pilot",
      "evidenceUse": "corroboration_only",
      "channels": [
        {
          "kind": "remote_mcp",
          "endpoint": "https://mcp.financialdatasets.ai/",
          "cost": "free_account_to_start",
          "auth": "oauth_or_api_key",
          "status": "candidate"
        }
      ],
      "licenseBoundary": "注册、额度和再分发条款需在接入时重新核验",
      "qualityNotes": [
        "财务事实优先回到 SEC filing",
        "价格与新闻需识别实际上游"
      ]
    }
  ]
} as const;
