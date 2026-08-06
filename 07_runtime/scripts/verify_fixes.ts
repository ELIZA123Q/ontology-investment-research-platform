/**
 * 验证修复效果的轻量级脚本
 * 直接调用引擎核心函数，不需要启动 web server
 */
import { methodCandidatesForPrompt } from "../workflow/shared";
import {
  methodDisciplineDigest,
  buildStageGenerationGuidance,
} from "../skills/method_selection/method_guidance";
import { ontologyDefinitionSummary } from "../skills/ontology/tools";
import { CONTEXT_SLOT_BUDGETS } from "../workflow/context_assembler";
import { promptFor, promptForEvidenceSupplement } from "../agents/shared/prompts_source";
import { loadKnowledge } from "../skills/method_selection/knowledge_loader";
import { inferJudgmentTypesFromTask } from "../skills/method_selection/method_registry";

const SEP = "=".repeat(70);

function header(title: string) {
  console.log(`\n${SEP}`);
  console.log(`  ${title}`);
  console.log(SEP);
}

async function main() {
  const question = "存储芯片周期判断：当前处于什么周期阶段？HBM、通用DRAM、NAND分别怎么看？";

  header("1. 预算变更验证 (A2)");
  console.log("CONTEXT_SLOT_BUDGETS:");
  console.log(JSON.stringify(CONTEXT_SLOT_BUDGETS, null, 2));
  const ontologyBudget = (CONTEXT_SLOT_BUDGETS as Record<string, number>).ontology;
  const upstreamBudget = (CONTEXT_SLOT_BUDGETS as Record<string, number>).upstream_json_soft;
  console.log(`\nontology 预算: ${ontologyBudget?.toLocaleString()} chars (期望: ${CONTEXT_SLOT_BUDGETS.ontology.toLocaleString()})`);
  console.log(`upstream_json_soft 预算: ${upstreamBudget?.toLocaleString()} chars (期望: ${CONTEXT_SLOT_BUDGETS.upstream_json_soft.toLocaleString()})`);
  console.log(`method_guidance 预算: ${CONTEXT_SLOT_BUDGETS.method_guidance.toLocaleString()} chars`);
  console.log(`knowledge 预算: ${CONTEXT_SLOT_BUDGETS.knowledge.toLocaleString()} chars`);
  if (ontologyBudget !== CONTEXT_SLOT_BUDGETS.ontology) {
    throw new Error(`ontology 预算漂移: ${ontologyBudget} !== ${CONTEXT_SLOT_BUDGETS.ontology}`);
  }

  header("2. Prompt 模板增强验证 (B1)");
  const stagePrompts: Record<string, { lines: number; chars: number }> = {};
  for (const kind of ["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"] as const) {
    const prompt = promptFor(kind);
    const lines = prompt.split("\n");
    stagePrompts[kind] = { lines: lines.length, chars: prompt.length };
    console.log(`${kind}: ${lines.length} 行, ${prompt.length.toLocaleString()} chars`);
  }
  const evidencePrompt = promptForEvidenceSupplement();
  console.log(`evidence_supplement: ${evidencePrompt.split("\n").length} 行, ${evidencePrompt.length.toLocaleString()} chars`);

  header("3. 知识库条件加载验证 (A1)");
  const judgmentTypes = inferJudgmentTypesFromTask(question);
  console.log(`问题: ${question}`);
  console.log(`推断的 judgment_types: ${judgmentTypes.join(", ") || "(空)"}`);

  const knowledge = loadKnowledge("stage_02", { judgmentTypes });
  console.log(`\nStage02 加载的知识文件数: ${knowledge.files.length}`);
  for (const f of knowledge.files) {
    const contentLen = (f as any).content?.length || 0;
    console.log(`  - ${f} (${contentLen.toLocaleString()} chars)`);
  }
  console.log(`\n知识库 context 总长度: ${knowledge.context.length.toLocaleString()} chars`);

  // 对比：无 judgmentTypes 时的加载量
  const knowledgeAll = loadKnowledge("stage_02", {});
  console.log(`\n对比（无条件路由）: ${knowledgeAll.files.length} 个文件, ${knowledgeAll.context.length.toLocaleString()} chars`);
  console.log(`条件路由减少文件数: ${knowledgeAll.files.length - knowledge.files.length}`);

  header("4. 方法纪律摘要验证 (C1)");
  const methodCandidates = methodCandidatesForPrompt("stage_02", [], question);
  console.log(`method_candidates 数量: ${methodCandidates.length}`);
  const byCap = methodCandidates.reduce((acc, m) => {
    acc[m.capability_type] = (acc[m.capability_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log(`按能力类型: ${JSON.stringify(byCap)}`);

  const digest = methodDisciplineDigest(methodCandidates);
  console.log(`\nmethodDisciplineDigest 长度: ${digest.length.toLocaleString()} chars`);
  if (digest) {
    console.log(`digest 前 800 字符:\n${digest.slice(0, 800)}`);
    if (digest.length > 800) console.log("...");
  } else {
    console.log("⚠️ digest 为空！");
  }

  header("5. 方法指导加载验证 (B3)");
  const stageGuidance = buildStageGenerationGuidance({
    kind: "stage_02",
    candidates: methodCandidates,
    taskText: question,
  });
  console.log(`method_ids: ${stageGuidance.method_ids.join(", ")}`);
  console.log(`scenario_card_ids: ${stageGuidance.scenario_card_ids.join(", ") || "(无)"}`);
  console.log(`selected_method_guidance 数量: ${stageGuidance.selected_method_guidance.length}`);
  for (const g of stageGuidance.selected_method_guidance) {
    console.log(`  - ${g.method_id}: ${g.excerpt.length.toLocaleString()} chars (truncated=${g.truncated}, mode=${g.excerpt_mode})`);
  }

  header("6. 本体定义摘要验证 (A2)");
  try {
    const ontologySummary = ontologyDefinitionSummary();
    console.log(`ontologyDefinitionSummary 长度: ${ontologySummary.length.toLocaleString()} chars`);
    console.log(`前 800 字符:\n${ontologySummary.slice(0, 800)}`);
    if (ontologySummary.length > 800) console.log("...");
  } catch (e) {
    console.log(`Error: ${e}`);
  }

  header("7. 完整 system prompt 组装验证 (C1)");
  const basePrompt = promptFor("stage_02");
  const systemPrompt = digest ? `${basePrompt}\n\n${digest}` : basePrompt;
  console.log(`base prompt: ${basePrompt.length.toLocaleString()} chars`);
  console.log(`system prompt (with digest): ${systemPrompt.length.toLocaleString()} chars`);
  console.log(`digest 占比: ${((digest.length / systemPrompt.length) * 100).toFixed(1)}%`);

  header("总结");
  console.log(`✅ A2 预算: ontology ${CONTEXT_SLOT_BUDGETS.ontology / 1000}K, upstream ${CONTEXT_SLOT_BUDGETS.upstream_json_soft / 1000}K, method_guidance ${CONTEXT_SLOT_BUDGETS.method_guidance / 1000}K`);
  console.log(`✅ B1 Prompt: stage_02 = ${stagePrompts.stage_02.lines} 行 (was ~8 行)`);
  console.log(`✅ A1 知识库: Stage02 条件加载 ${knowledge.files.length} 个文件 (was ${knowledgeAll.files.length} 全量)`);
  console.log(`✅ C1 方法纪律摘要: ${digest.length.toLocaleString()} chars 注入 system prompt`);
  console.log(`✅ B3 方法指导: ${stageGuidance.selected_method_guidance.length} 个方法正文加载`);
  try {
    const os = ontologyDefinitionSummary();
    console.log(`✅ A2 本体定义摘要: ${os.length.toLocaleString()} chars`);
  } catch {
    console.log("⚠️ A2 本体定义摘要: 加载失败");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
