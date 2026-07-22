import { createRun, listRuns } from "@/adapters/db";
import { listActiveResearchJobs } from "@/adapters/research_jobs";
import {
  createExperienceCohortRun,
  ExperienceCohortAlreadyEnrolledError,
  ExperienceCohortIneligibleDatabaseError,
  getExperienceCohortCaseDefinition,
} from "@/adapters/experience_cohort";
import { defaultExamplePackages } from "@/engine/instance_graph";

export const runtime = "nodejs";

export async function GET() {
  const activeJobs = listActiveResearchJobs(12).map((job) => ({
    id: job.id,
    run_id: job.run_id,
    stage: job.stage,
    status: job.status,
    job_type: job.job_type,
    updated_at: job.updated_at,
    last_error: job.last_error,
  }));
  return Response.json({
    runs: listRuns(),
    example_packages: defaultExamplePackages(),
    active_jobs: activeJobs,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const question = String(body.question || "").trim();
    const domain = String(body.domain || "semiconductor");
    const packagePath = body.package_path ? String(body.package_path) : null;
    const experienceCaseId = body.experience_case_id ? String(body.experience_case_id) : "";
    if (!question) return Response.json({ error: "请输入研究问题" }, { status: 400 });
    const experienceCase = experienceCaseId ? getExperienceCohortCaseDefinition(experienceCaseId) : null;
    if (experienceCaseId && !experienceCase) {
      return Response.json({ error: "体验基线案例不存在" }, { status: 400 });
    }
    if (experienceCase) {
      const normalized = (value: string) => value.trim().replace(/\s+/g, " ");
      if (domain !== "semiconductor" || normalized(question) !== normalized(experienceCase.question)) {
        return Response.json({ error: "体验基线任务的问题和领域必须保持冻结" }, { status: 400 });
      }
    }
    try {
      const run = experienceCase
        ? createExperienceCohortRun(experienceCase, packagePath)
        : createRun(question, domain, packagePath);
      return Response.json(run, { status: 201 });
    } catch (error) {
      if (error instanceof ExperienceCohortAlreadyEnrolledError) {
        return Response.json({ error: "该体验基线任务已经登记，请继续已有研究" }, { status: 409 });
      }
      if (error instanceof ExperienceCohortIneligibleDatabaseError) {
        return Response.json({
          error: "当前连接临时 QA 数据库，不能登记为正式前瞻样本",
          database_path: error.databasePath,
        }, { status: 403 });
      }
      throw error;
    }
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
}
