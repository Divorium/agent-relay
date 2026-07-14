import type { CreateJobRequest } from "../contracts/job.js";

export function buildCodexPrompt(request: CreateJobRequest, resultPath: string): string {
  return [
    `Implement the active ExecPlan at ${request.planPath} in the current checked-out repository.`,
    `Execution mode: ${request.mode}.`,
    "Keep the active plan current. If an item cannot be completed, leave it unchecked and mark it [blocked] with its cause, impact, evidence, and unblock condition. Continue all other work.",
    "Run the validation required by the active plan.",
    "Do not run commands that create or publish Git commits.",
    `Before exiting, write ${resultPath} as JSON with schemaVersion 1, requestId ${request.requestId}, summary, and validation.`,
    "Do not include status, blockers, limitations, shouldCommit, or commitMessage.",
    "Do not include secrets or raw sensitive logs in the result file.",
  ].join("\n");
}
