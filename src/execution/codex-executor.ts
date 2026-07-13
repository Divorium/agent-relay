import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RelayError } from "../contracts/errors.js";
import type { CreateJobRequest } from "../contracts/job.js";
import { validateCodexResult } from "../contracts/validators.js";
import type { CodexResult } from "../contracts/result.js";
import { buildCodexPrompt } from "./prompt.js";
import { redactSensitiveText } from "../security/redaction.js";

export interface ExecutionOutcome { exitCode: number; result: CodexResult; }

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
    const child = spawn(this.command, ["exec", "--cd", workspace, prompt], {
      cwd: workspace,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const collect = (chunk: any): void => {
      if (output.length >= this.maxOutputBytes) return;
      output += String(chunk).slice(0, this.maxOutputBytes - output.length);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
        void killTimer;
        reject(new RelayError("CODEX_TIMEOUT", "Codex execution timed out", 504));
      }, this.timeoutMs);
      child.on("error", (error: Error) => { clearTimeout(timer); reject(new RelayError("CODEX_FAILED", error.message, 502)); });
      child.on("close", (code: number | null) => { clearTimeout(timer); resolve(code ?? 1); });
    }).finally(async () => { await writeFile(outputPath, redactSensitiveText(output), { mode: 0o600 }); });

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
