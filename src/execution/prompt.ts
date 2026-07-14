import type { CreateJobRequest } from "../contracts/job.js";

export function buildCodexPrompt(request: CreateJobRequest, resultPath: string): string {
  const findings = request.reviewFindings?.length
    ? `\nReview findings to address:\n${request.reviewFindings.map((item) => `- ${item}`).join("\n")}\n`
    : "";
  return `Work in the current checked-out repository.\nRead and follow the complete AGENTS.md instruction chain and the active plan at ${request.planPath}.\nExecution mode: ${request.mode}.${findings}\nImplement the requested work, update the active plan as progress is made, and run all validation available in this environment.\nNever run git commit, git push, or any equivalent command that creates or publishes repository commits. The GitHub runner exclusively owns commit and push. You may inspect git status and git diff. Do not access GitHub credentials.\nBefore exiting, write ${resultPath} as JSON with schemaVersion 1, requestId ${request.requestId}, status, a one-line commitMessage when status is completed, summary, validation, blockers, and limitations. Do not include shouldCommit; the runner decides whether a commit is needed from the actual Git worktree.\nNever include secrets or raw sensitive logs in the result file.`;
}
