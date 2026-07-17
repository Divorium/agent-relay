export function buildCodexPrompt(planPath: string): string {
  return `Follow .agent/PLANS.md and execute the active ExecPlan at ${planPath}.`;
}
