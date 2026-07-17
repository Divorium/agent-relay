import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CodexExecutor } from "./execution/codex-executor.js";
import { CodexExecutionError } from "./execution/errors.js";
import { assertActivePlanFile, resolveWorkspace } from "./security/workspace.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f]/gu;
const ACTIVE_PLAN_PATH = /^docs\/exec-plans\/active\/[A-Za-z0-9._-]+\.md$/u;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || CONTROL_CHARACTERS.test(value)) {
    throw new CodexExecutionError("INVALID_CONFIGURATION", `${name} is required and must not contain control characters`);
  }
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new CodexExecutionError("INVALID_CONFIGURATION", `${name} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new CodexExecutionError("INVALID_CONFIGURATION", `${name} is outside the supported range`);
  }
  return value;
}

export function deriveCommitMessage(plan: string): string {
  const heading = plan.split(/\r?\n/u).find((line) => /^#[ \t]+\S/u.test(line));
  const source = heading ? heading.replace(/^#[ \t]+/u, "") : "";
  const normalized = source.replace(CONTROL_CHARACTERS_GLOBAL, " ").replace(/\s+/gu, " ").trim();
  return Array.from(normalized || "Apply active ExecPlan").slice(0, 120).join("").trim();
}

export async function main(): Promise<void> {
  const workspaceInput = requiredEnvironment("GITHUB_WORKSPACE");
  const githubOutput = requiredEnvironment("GITHUB_OUTPUT");
  const planPath = requiredEnvironment("CODEX_PLAN_PATH");
  const workspaceRoot = requiredEnvironment("CODEX_WORKSPACE_ROOT");
  const home = requiredEnvironment("HOME");
  if (!ACTIVE_PLAN_PATH.test(planPath)) {
    throw new CodexExecutionError("INVALID_PLAN", "CODEX_PLAN_PATH must identify a Markdown file directly under docs/exec-plans/active");
  }

  const timeoutMs = positiveInteger("CODEX_TIMEOUT_MS", 21_600_000);
  const maxOutputBytes = positiveInteger("MAX_OUTPUT_BYTES", 10_000_000);
  const workspace = await resolveWorkspace(workspaceRoot, workspaceInput);
  const planFile = await assertActivePlanFile(workspace, planPath);
  const commitMessage = deriveCommitMessage(await readFile(planFile, "utf8"));
  const runtimeRoot = join(home, ".cache", "agent-relay-runtime");
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  await chmod(runtimeRoot, 0o700);

  const executor = new CodexExecutor(
    "/usr/local/bin/codex-run",
    timeoutMs,
    maxOutputBytes,
    workspaceRoot,
    home,
    runtimeRoot,
  );
  await executor.run(planPath, workspace);
  await appendFile(githubOutput, `commit_message=${commitMessage}\n`, "utf8");
}

if (process.argv[1]?.endsWith("run-codex.js")) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
