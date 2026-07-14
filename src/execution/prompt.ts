import type { CreateJobRequest } from "../contracts/job.js";

export function buildCodexPrompt(request: CreateJobRequest, resultPath: string): string {
  return [
    `Implement the active ExecPlan at ${request.planPath} in the current checked-out repository.`,
    `Execution mode: ${request.mode}.`,
    "Keep the active plan current and run the validation it requires.",
    "Do not run commands that create or publish Git commits.",
    `Before exiting, write ${resultPath} as JSON with schemaVersion 1, requestId ${request.requestId}, status, a one-line commitMessage when status is completed, summary, validation, blockers, and limitations.`,
    "Do not include secrets or raw sensitive logs in the result file.",
  ].join("\n");
}
