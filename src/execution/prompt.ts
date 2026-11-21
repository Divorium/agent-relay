export function buildCodexPrompt(planPath: string): string {
  return `Follow .agent/PLANS.md and execute the active ExecPlan at ${planPath}. Codex runs natively on the self-hosted runner. Follow repository instructions, perform the required work and verification, and record the outcomes. Do not execute Git commands; the trusted finalizer owns commits and pushes.`;
}
