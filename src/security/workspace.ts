import { lstat, realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { RelayError } from "../contracts/errors.js";

function isOutside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === ".." || rel.startsWith(`..${sep}`) || resolve(root, rel) !== candidate;
}

export async function resolveWorkspace(root: string, requestedRelativePath: string): Promise<string> {
  const resolvedRoot = await realpath(root);
  const candidate = resolve(resolvedRoot, requestedRelativePath);
  let resolvedCandidate: string;
  try {
    resolvedCandidate = await realpath(candidate);
  } catch {
    throw new RelayError("WORKSPACE_NOT_FOUND", "Workspace does not exist", 404);
  }
  if (isOutside(resolvedRoot, resolvedCandidate)) {
    throw new RelayError("WORKSPACE_OUTSIDE_ROOT", "Workspace resolves outside shared root", 400);
  }
  const info = await stat(resolvedCandidate);
  if (!info.isDirectory()) throw new RelayError("WORKSPACE_NOT_FOUND", "Workspace is not a directory", 404);
  return resolvedCandidate;
}

export async function assertActivePlanFile(workspace: string, planPath: string): Promise<void> {
  const activeRoot = resolve(workspace, "docs", "exec-plans", "active");
  const candidate = resolve(workspace, planPath);
  const relativePlan = relative(activeRoot, candidate);
  if (!relativePlan || relativePlan.includes(sep) || isOutside(activeRoot, candidate)) {
    throw new RelayError("INVALID_REQUEST", "Active ExecPlan must be a direct file under docs/exec-plans/active", 400);
  }

  let info;
  try {
    info = await lstat(candidate);
  } catch {
    throw new RelayError("INVALID_REQUEST", "Active ExecPlan does not exist", 400);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new RelayError("INVALID_REQUEST", "Active ExecPlan must be a regular file", 400);
  }

  const resolvedCandidate = await realpath(candidate);
  if (resolvedCandidate !== candidate) {
    throw new RelayError("INVALID_REQUEST", "Active ExecPlan must not traverse symbolic links", 400);
  }
}
