import { realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { RelayError } from "../contracts/errors.js";

export async function resolveWorkspace(root: string, requestedRelativePath: string): Promise<string> {
  const resolvedRoot = await realpath(root);
  const candidate = resolve(resolvedRoot, requestedRelativePath);
  let resolvedCandidate: string;
  try {
    resolvedCandidate = await realpath(candidate);
  } catch {
    throw new RelayError("WORKSPACE_NOT_FOUND", "Workspace does not exist", 404);
  }
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "") return resolvedCandidate;
  if (rel.startsWith(`..${sep}`) || rel === ".." || resolve(resolvedRoot, rel) !== resolvedCandidate) {
    throw new RelayError("WORKSPACE_OUTSIDE_ROOT", "Workspace resolves outside shared root", 400);
  }
  const info = await stat(resolvedCandidate);
  if (!info.isDirectory()) throw new RelayError("WORKSPACE_NOT_FOUND", "Workspace is not a directory", 404);
  return resolvedCandidate;
}
