import type { CreateJobRequest } from "../contracts/job.js";

export function buildCodexPrompt(request: CreateJobRequest): string {
  return `Follow the active ExecPlan at ${request.planPath} in the current checked-out repository.`;
}
