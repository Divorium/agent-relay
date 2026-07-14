import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RelayError } from "../contracts/errors.js";
import type { CreateJobRequest } from "../contracts/job.js";
import { validateCodexResult } from "../contracts/validators.js";
import type { CodexResult } from "../contracts/result.js";
import { buildCodexPrompt } from "./prompt.js";
import { redactSensitiveText } from "../security/redaction.js";

export interface ExecutionOutcome { exitCode: number; result: CodexResult; }

const CODEX_BLOCKED_ENVIRONMENT_VARIABLES = new Set(["AGENT_RELAY_TOKEN"]);

export function createCodexEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && !CODEX_BLOCKED_ENVIRONMENT_VARIABLES.has(name)) environment[name] = value;
  }
  return environment;
}

export class CodexExecutor {
  constructor(
    private readonly command: string,
    private readonly timeoutMs: number,
    private readonly maxOutputBytes: number,
  ) {}

  async run(request: CreateJobRequest, workspace: string, outputPath: string): Promise<ExecutionOutcome> {
    const resultPath = join(workspace, ".agent-relay", "result.json");
    await mkdir(dirname(resultPath), { recursive: true });
    await rm(resultPath, { force: true });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, "", { mode: 0o600 });

    const prompt = buildCodexPrompt(request, ".agent-relay/result.json");
    const child = spawn(this.command, [
      "--ask-for-approval",
      "never",
      "-c",
      "features.memories=false",
      "exec",
      "--sandbox",
      "danger-full-access",
      "--cd",
      workspace,
      prompt,
    ], {
      cwd: workspace,
      env: createCodexEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let outputBytes = 0;
    let pendingWrite = Promise.resolve();
    const collect = (chunk: unknown): void => {
      if (outputBytes >= this.maxOutputBytes) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const remaining = this.maxOutputBytes - outputBytes;
      const accepted = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
      outputBytes += accepted.length;
      const redacted = redactSensitiveText(accepted.toString("utf8"));
      process.stdout.write(redacted);
      pendingWrite = pendingWrite.then(() => appendFile(outputPath, redacted, { mode: 0o600 }));
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    let timedOut = false;
    let forceKillTimer: any;
    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      }, this.timeoutMs);

      child.on("error", (error: Error) => {
        clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        reject(new RelayError("CODEX_FAILED", error.message, 502));
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        resolve(code ?? 1);
      });
    });
    await pendingWrite;

    if (timedOut) throw new RelayError("CODEX_TIMEOUT", "Codex execution timed out", 504);
    if (exitCode !== 0) throw new RelayError("CODEX_FAILED", `Codex exited with code ${exitCode}`, 502);

    let raw: string;
    try { raw = await readFile(resultPath, "utf8"); }
    catch { throw new RelayError("RESULT_MISSING", "Codex did not write the required result file", 422); }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new RelayError("RESULT_INVALID", "Codex result is not valid JSON", 422); }
    return { exitCode, result: validateCodexResult(parsed, request.requestId) };
  }
}
