// GENERATED FILE. DO NOT EDIT.
// Source: 05_control_evaluation/01_rules/policies/financial_model_integrity_policy.yaml
// Regenerate: python3 scripts/generate-financial-model-rules.py

export const FINANCIAL_MODEL_RULES = {
  "authority": "control_policy",
  "derived_outputs": {
    "differences": [
      {
        "formula": "reported net profit - adjusted net profit",
        "id": "reported_adjusted_net_profit_gap",
        "interpretation_boundary": "不得将差额自动归因于某一单项损益",
        "label": "归母净利润与扣非归母净利润差额",
        "minuend": "net_profit",
        "subtrahend": "adjusted_net_profit",
        "unit": "元"
      }
    ],
    "growth": [
      {
        "formula": "(current - prior) / abs(prior) * 100",
        "id": "revenue_growth",
        "label": "营业收入同比增速",
        "metric": "revenue",
        "unit": "%",
        "zero_denominator_behavior": "not_testable"
      },
      {
        "formula": "(current - prior) / abs(prior) * 100",
        "id": "operating_profit_growth",
        "label": "营业利润同比增速",
        "metric": "operating_profit",
        "unit": "%",
        "zero_denominator_behavior": "not_testable"
      },
      {
        "formula": "(current - prior) / abs(prior) * 100",
        "id": "net_profit_growth",
        "label": "归母净利润同比增速",
        "metric": "net_profit",
        "unit": "%",
        "zero_denominator_behavior": "not_testable"
      },
      {
        "formula": "(current - prior) / abs(prior) * 100",
        "id": "adjusted_net_profit_growth",
        "label": "扣非归母净利润同比增速",
        "metric": "adjusted_net_profit",
        "unit": "%",
        "zero_denominator_behavior": "not_testable"
      }
    ],
    "ratios": [
      {
        "denominator": "revenue",
        "formula": "operating_profit / revenue * 100",
        "id": "operating_profit_margin",
        "label": "营业利润率",
        "numerator": "operating_profit",
        "unit": "%"
      },
      {
        "denominator": "revenue",
        "formula": "net_profit / revenue * 100",
        "id": "net_profit_margin",
        "label": "净利率",
        "numerator": "net_profit",
        "unit": "%"
      }
    ]
  },
  "governance": {
    "executor": "06_runtime/src/research/deterministic-financial-model.ts",
    "generated_projection": "06_runtime/src/research/generated/financial-model-rules.ts",
    "projection_generator": "06_runtime/scripts/generate-financial-model-rules.py",
    "source_of_truth": "05_control_evaluation/01_rules/policies/financial_model_integrity_policy.yaml",
    "tests": [
      "06_runtime/tests/financial-capability.test.ts",
      "06_runtime/tests/financial-model-rules-projection.test.ts"
    ],
    "validator": "06_runtime/src/research/financial-model-contract.ts"
  },
  "metric_aliases": {
    "adjusted_net_profit": [
      "adjusted_net_profit",
      "adjusted_net_profit_attributable",
      "net_profit_excluding_nonrecurring"
    ],
    "beginning_cash": [
      "beginning_cash",
      "cash_and_cash_equivalents_begin"
    ],
    "ending_cash": [
      "ending_cash",
      "cash_and_cash_equivalents_end"
    ],
    "financing_cash_flow": [
      "financing_cash_flow",
      "net_cash_from_financing_activities"
    ],
    "fx_effect": [
      "fx_effect",
      "effect_of_exchange_rate_changes_on_cash"
    ],
    "investing_cash_flow": [
      "investing_cash_flow",
      "net_cash_from_investing_activities"
    ],
    "net_profit": [
      "net_profit",
      "net_profit_attributable",
      "parent_net_profit"
    ],
    "operating_cash_flow": [
      "operating_cash_flow",
      "net_cash_from_operating_activities"
    ],
    "operating_profit": [
      "operating_profit"
    ],
    "revenue": [
      "revenue",
      "operating_revenue",
      "total_operating_revenue"
    ],
    "total_assets": [
      "total_assets"
    ],
    "total_equity": [
      "total_equity",
      "shareholders_equity"
    ],
    "total_liabilities": [
      "total_liabilities"
    ]
  },
  "model_scopes": [
    "historical_earnings_update",
    "forecast_model"
  ],
  "purpose": "规定可重复执行的财务数据归一、派生指标、三表勾稽与估值阻断条件。 本策略只判断财务制品是否可用，不构成公司基本面、估值或投资结论。",
  "reconciliations": [
    {
      "failure_behavior": "block_model",
      "formula": "total_assets - total_liabilities - total_equity",
      "id": "balance_sheet_equation",
      "inputs": [
        "total_assets",
        "total_liabilities",
        "total_equity"
      ],
      "kind": "balance_sheet",
      "missing_behavior": "not_testable",
      "tolerance": {
        "absolute": 1,
        "relative": 1e-06,
        "relative_to": "total_assets"
      }
    },
    {
      "failure_behavior": "block_model",
      "formula": "ending_cash - (beginning_cash + operating_cash_flow + investing_cash_flow + financing_cash_flow + fx_effect)",
      "id": "cash_flow_rollforward",
      "inputs": [
        "ending_cash",
        "beginning_cash",
        "operating_cash_flow",
        "investing_cash_flow",
        "financing_cash_flow"
      ],
      "kind": "cash_flow",
      "missing_behavior": "not_testable",
      "optional_inputs": [
        "fx_effect"
      ],
      "tolerance": {
        "absolute": 1,
        "relative": 1e-06,
        "relative_to": "ending_cash"
      }
    }
  ],
  "rule_ids": [
    "FIN-MODEL-INTEGRITY-001"
  ],
  "schema_name": "financial_model_integrity_policy",
  "schema_version": "1.0.0",
  "scope": "A 股基本面研究的结构化财务模型与估值准入",
  "status": "active",
  "unit_normalization": {
    "mixed_currency_behavior": "block_without_frozen_fx_rate",
    "monetary": {
      "canonical_currency": "CNY",
      "canonical_unit": "元",
      "supported": {
        "CNY": {
          "万元": 10000,
          "亿元": 100000000,
          "元": 1,
          "千元": 1000,
          "百万元": 1000000
        }
      }
    },
    "non_monetary_units": [
      "%",
      "倍",
      "股"
    ],
    "per_share_suffix": "/股",
    "unsupported_unit_behavior": "block"
  },
  "valuation_gate": {
    "missing_behavior": "blocked",
    "required_fields": [
      "methods",
      "assumptions",
      "sensitivities"
    ],
    "required_model_scope": "forecast_model",
    "required_output_scenario": "base"
  }
} as const;
