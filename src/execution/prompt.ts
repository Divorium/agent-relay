import type { CreateJobRequest } from "../contracts/job.js";

export function buildCodexPrompt(request: CreateJobRequest): string {
  return [
    `Implement the active ExecPlan at ${request.planPath} in the current checked-out repository.`,
    "Maintain it according to .agent/PLANS.md.",
    "Run the validation required by the active plan.",
    "Do not run commands that create or publish Git commits.",
  ].join("\n");
}
