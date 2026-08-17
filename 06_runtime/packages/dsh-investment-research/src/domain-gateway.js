export const DSH_GATEWAY_API_VERSION = "v1";
export const DSH_GATEWAY_TOKEN_HEADER = "x-investment-dsh-token";

export const FORBIDDEN_MODEL_COMMANDS = new Set([
  "confirm_plan", "confirm_evidence", "approve_judgment", "publish", "revise_judgment", "revise_report",
]);

export class InvestmentDomainGatewayError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "InvestmentDomainGatewayError";
    this.status = status;
  }
}

export function assertModelCommandPermitted(command) {
  if (FORBIDDEN_MODEL_COMMANDS.has(command)) {
    throw new InvestmentDomainGatewayError(`Researcher confirmation is required for ${command}`, 403);
  }
}

function urlFor(baseUrl, path) {
  return new URL(`/api/dsh/${DSH_GATEWAY_API_VERSION}${path}`, baseUrl).toString();
}

function artifactRefs(value) {
  const runtimeArtifacts = value?.runtime?.artifacts;
  if (Array.isArray(runtimeArtifacts)) return runtimeArtifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, version: artifact.version }));
  if (value?.artifactId) return [{ id: value.artifactId, version: value.artifactVersion }];
  return [];
}

function envelope(operation, value, request = {}) {
  const researchCase = value?.researchCase || value;
  const runtime = value?.runtime;
  return {
    apiVersion: DSH_GATEWAY_API_VERSION,
    operation,
    researchCaseId: value?.researchCaseId || researchCase?.id || request.researchCaseId,
    taskId: value?.taskId || researchCase?.taskId || runtime?.task?.id,
    knowledgeBundleId: value?.knowledgeRunLock?.bundleId || researchCase?.bundleId,
    artifactRefs: artifactRefs(value),
    idempotencyKey: request.idempotencyKey,
    data: value,
  };
}

/** A narrow HTTP client. It deliberately contains no SQLite, ontology, or approval logic. */
export class InvestmentDomainGateway {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.baseUrl = config?.baseUrl || "http://127.0.0.1:3000";
    this.apiToken = config?.apiToken || "";
    this.fetch = fetchImpl;
  }

  async request(method, path, body) {
    if (!this.apiToken) throw new InvestmentDomainGatewayError("DSH gateway apiToken is required", 503);
    const response = await this.fetch(urlFor(this.baseUrl, path), {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        [DSH_GATEWAY_TOKEN_HEADER]: this.apiToken,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new InvestmentDomainGatewayError(String(payload?.error || `Domain gateway returned HTTP ${response.status}`), response.status);
    return payload;
  }

  async listResearchCases() {
    return envelope("research_case.list", await this.request("GET", "/research-cases"));
  }

  async createResearchCase(input) {
    const value = await this.request("POST", "/research-cases", input);
    return envelope("research_case.create", value, { idempotencyKey: input.idempotencyKey });
  }

  async getResearchCase(researchCaseId) {
    return envelope("research_case.get", await this.request("GET", `/research-cases/${encodeURIComponent(researchCaseId)}`), { researchCaseId });
  }

  async querySource(input) {
    const { researchCaseId, ...request } = input;
    const value = await this.request("POST", `/research-cases/${encodeURIComponent(researchCaseId)}/source-query`, request);
    return envelope("evidence.query", value, { researchCaseId, idempotencyKey: input.idempotencyKey });
  }
}
