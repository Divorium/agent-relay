import type { CreateJobRequest } from "../contracts/job.js";

export function buildCodexPrompt(request: CreateJobRequest): string {
  return `Follow .agent/PLANS.md and execute the active ExecPlan at ${request.planPath}.`;
}
