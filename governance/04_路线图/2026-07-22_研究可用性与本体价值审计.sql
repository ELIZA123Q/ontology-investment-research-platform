-- 本轮审计读者报告的可复现快照查询。
-- 数值来源与口径见同目录 2026-07-22_研究可用性与本体价值审计证据.md。

CREATE TEMP VIEW engineering_metrics AS
SELECT '通过' AS status, 195 AS runtime_tests, 51 AS ontology_objects, 116 AS ontology_relations, 43 AS method_assets;

CREATE TEMP VIEW formal_pack_metrics AS
SELECT 46.0 / 48.0 AS coverage_rate, 46 AS coverage_backed, 48 AS coverage_total,
       7 AS judgment_units, 19 AS source_captures, 1 AS publishable, 'J2' AS max_judgment;

CREATE TEMP VIEW evaluation_metrics AS
SELECT '尚未证明' AS status, 'calibration_failed' AS latest_run_status,
       38 AS error_responses, 3 AS real_runs_failed, 1 AS mock_completed;

CREATE TEMP VIEW rule_execution AS
SELECT 'Runtime 语义执行' AS execution_surface, 9 AS rule_count, 0.9 AS coverage_share,
       'implemented' AS implementation_status,
       '通用五规则、状态时间、代理披露、认证阶段、产能/良率范围' AS rule_examples
UNION ALL
SELECT '实例图合同', 1, 0.1, 'implemented', '关系端点兼容';

CREATE TEMP VIEW audit_findings AS
SELECT 'P0' AS priority, '研究价值验证' AS dimension, '未完成' AS current_state,
       '3 次真实单供应商评测校准失败；最近一次 38 个请求报错' AS evidence,
       '不能宣称流程已提高平台级研究可靠率' AS implication
UNION ALL
SELECT 'P0', '信息充分性', '单样例足够、平台级不足',
       '正式样例 46/48 覆盖，7 个判断单元；仍有关键连续序列缺口',
       '允许边界化 J2 与 J0 正确停止，不支持普遍化'
UNION ALL
SELECT 'P1', '正式本体执行', '已完成', '10 条正式规则全部有执行面；Runtime 3.0 每个判断执行 9 条，实例图合同执行 1 条',
       '执行覆盖已闭环，真实研究增益仍待评测'
UNION ALL
SELECT 'P1', '本体治理闭环', '已完成', '已有 task_local 隔离、跨任务聚合、专家确认及晋升/驳回历史，并对跨 run 口径差异显式挡门',
       '需要把重复缺口变成可治理的本体演化信号'
UNION ALL
SELECT 'P1', '领域泛化', '未证明', '正式覆盖以半导体为主；第二领域仍是压力测试脚手架',
       '先验证通用核心，再决定扩领域';

SELECT * FROM engineering_metrics;
SELECT * FROM formal_pack_metrics;
SELECT * FROM evaluation_metrics;
SELECT * FROM rule_execution ORDER BY rule_count DESC, execution_surface;
SELECT * FROM audit_findings ORDER BY priority, dimension;
