import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { RelayError } from "../contracts/errors.js";
import type { CreateJobRequest, JobRecord } from "../contracts/job.js";
import { assertActivePlanFile, resolveWorkspace } from "../security/workspace.js";
import { JobStore } from "../persistence/job-store.js";
import { CodexExecutor } from "../execution/codex-executor.js";
import type { OutputStore } from "../persistence/output-store.js";

function sameRequest(a: CreateJobRequest, b: CreateJobRequest): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class JobService {
  private activeJobId: string | undefined;
  private acceptingJob = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly stateDir: string,
    private readonly store: JobStore,
    private readonly executor: CodexExecutor,
    private readonly outputStore?: OutputStore,
  ) {}

  async init(): Promise<void> {
    await this.store.init();
    await this.store.markRunningJobsInterrupted();
  }

  async create(request: CreateJobRequest): Promise<JobRecord> {
    const existing = await this.store.findByRequestId(request.requestId);
    if (existing) {
      if (!sameRequest(existing.request, request)) {
        throw new RelayError("REQUEST_ID_CONFLICT", "requestId was already used with different fields", 409);
      }
      return existing;
    }
    if (this.activeJobId || this.acceptingJob) {
      throw new RelayError("JOB_ALREADY_RUNNING", "Another Codex job is already running", 409);
    }

    this.acceptingJob = true;
    try {
      const workspace = await resolveWorkspace(this.workspaceRoot, request.workspace);
      await assertActivePlanFile(workspace, request.planPath);
      const id = randomUUID();
      const now = new Date().toISOString();
      const job: JobRecord = {
        id,
        request,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
        outputPath: join(this.stateDir, "logs", `${id}.log`),
      };

      let outputPrepared = false;
      try {
        if (this.outputStore) {
          await this.outputStore.prepare(job.id, job.outputPath);
          outputPrepared = true;
        }
        await this.store.save(job);
        await this.store.index(job);
      } catch {
        let compensationFailed = false;
        if (outputPrepared && this.outputStore) {
          try { await this.outputStore.discard(job.id); } catch { compensationFailed = true; }
        }
        try { await this.store.removeRequestId(request.requestId, id); } catch { compensationFailed = true; }
        try { await this.store.remove(id); } catch { compensationFailed = true; }
        const detail = compensationFailed ? " and rollback was incomplete" : "";
        throw new RelayError("JOB_PREPARATION_FAILED", `Could not persist the job${detail}`, 500);
      }

      this.activeJobId = id;
      void this.execute(job, workspace);
      return job;
    } finally {
      this.acceptingJob = false;
    }
  }

  async get(id: string): Promise<JobRecord> {
    const job = await this.store.get(id);
    if (!job) throw new RelayError("JOB_NOT_FOUND", "Job not found", 404);
    return job;
  }

  private async execute(job: JobRecord, workspace: string): Promise<void> {
    let current = job;
    try {
      const started = new Date().toISOString();
      current = { ...job, status: "running", startedAt: started, updatedAt: started };
      await this.store.save(current);

      const outcome = await this.executor.run(job.request, workspace, job.outputPath, job.id);
      const finished = new Date().toISOString();
      const terminal: JobRecord = {
        ...current,
        status: "completed",
        exitCode: outcome.exitCode,
        finishedAt: finished,
        updatedAt: finished,
      };
      await this.store.save(terminal);
      if (this.outputStore) await this.outputStore.complete(job.id, terminal.status);
    } catch (error) {
      const relayError = error instanceof RelayError
        ? error
        : new RelayError("INTERNAL_ERROR", "Unexpected job failure", 500);
      const finished = new Date().toISOString();
      const status = relayError.code === "CODEX_TIMEOUT" ? "timed_out" : "failed";
      try {
        const terminal: JobRecord = {
          ...current,
          status,
          finishedAt: finished,
          updatedAt: finished,
          errorCode: relayError.code,
          errorMessage: relayError.message,
        };
        await this.store.save(terminal);
        if (this.outputStore) {
          if (relayError.code === "OUTPUT_WRITE_FAILED" || relayError.code === "OUTPUT_LIMIT_EXCEEDED") {
            await this.outputStore.fail(job.id, relayError);
          } else {
            await this.outputStore.complete(job.id, terminal.status);
          }
        }
      } catch {
        if (this.outputStore) await this.outputStore.fail(job.id, relayError).catch(() => undefined);
      }
    } finally {
      if (this.activeJobId === job.id) this.activeJobId = undefined;
    }
  }
}
