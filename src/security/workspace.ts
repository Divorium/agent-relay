import { realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { CodexExecutionError } from "../execution/errors.js";

function isOutside(root: string, candidate: string): boolean {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return !candidate.startsWith(prefix);
}

export async function resolveWorkspace(root: string, requestedPath: string): Promise<string> {
  let resolvedRoot: string;
  let resolvedWorkspace: string;
  try {
    resolvedRoot = await realpath(root);
    resolvedWorkspace = await realpath(requestedPath);
  } catch {
    throw new CodexExecutionError("WORKSPACE_NOT_FOUND", "Workspace or workspace root does not exist");
  }
  if (resolvedWorkspace === resolvedRoot || isOutside(resolvedRoot, resolvedWorkspace)) {
    throw new CodexExecutionError("WORKSPACE_OUTSIDE_ROOT", "GITHUB_WORKSPACE must be below CODEX_WORKSPACE_ROOT");
  }
  const info = await stat(resolvedWorkspace);
  if (!info.isDirectory()) throw new CodexExecutionError("WORKSPACE_NOT_FOUND", "GITHUB_WORKSPACE is not a directory");
  return resolvedWorkspace;
}

export async function assertActivePlanFile(workspace: string, planPath: string): Promise<string> {
  const activeRoot = resolve(workspace, "docs", "exec-plans", "active");
  const candidate = resolve(workspace, planPath);
  const relativePlan = relative(activeRoot, candidate);
  if (!relativePlan || relativePlan.includes(sep) || !relativePlan.endsWith(".md")) {
    throw new CodexExecutionError("INVALID_PLAN", "Active ExecPlan must be a Markdown file directly under docs/exec-plans/active");
  }
  let resolvedCandidate: string;
  try {
    resolvedCandidate = await realpath(candidate);
  } catch {
    throw new CodexExecutionError("INVALID_PLAN", "Active ExecPlan does not exist");
  }
  if (resolvedCandidate !== candidate) throw new CodexExecutionError("INVALID_PLAN", "Active ExecPlan must not traverse symbolic links");
  const info = await stat(resolvedCandidate);
  if (!info.isFile()) throw new CodexExecutionError("INVALID_PLAN", "Active ExecPlan must be a regular file");
  return resolvedCandidate;
}
