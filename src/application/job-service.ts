import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { RelayError } from "../contracts/errors.js";
import type { CreateJobRequest, JobRecord } from "../contracts/job.js";
import { resolveWorkspace } from "../security/workspace.js";
import { JobStore } from "../persistence/job-store.js";
import { CodexExecutor } from "../execution/codex-executor.js";
import { OutputStore } from "../persistence/output-store.js";

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
    private readonly outputStore: OutputStore,
    private readonly executor: CodexExecutor,
  ) {}

  async init(): Promise<void> {
    await this.store.init();
    const recovered = await this.store.markRunningJobsInterrupted();
    for (const job of recovered) {
      await this.outputStore.attach(job);
    }
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
    let createdJob: JobRecord | undefined;
    try {
      const workspace = await resolveWorkspace(this.workspaceRoot, request.workspace);
      const id = randomUUID();
      const now = new Date().toISOString();
      createdJob = {
        id,
        request,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
        resultPath: join(workspace, ".agent-relay", "result.json"),
        outputPath: join(this.stateDir, "logs", `${id}.log`),
      };
      await this.outputStore.prepare(createdJob.id, createdJob.outputPath);
      await this.store.save(createdJob);
      await this.store.index(createdJob);
      const job = createdJob;
      this.activeJobId = id;
      void this.execute(job, workspace);
      return job;
    } catch (error) {
      if (createdJob) {
        await this.outputStore.discard(createdJob.id).catch(() => undefined);
        await this.store.delete(createdJob.id).catch(() => undefined);
        await this.store.removeRequestId(createdJob.request.requestId).catch(() => undefined);
      }
      throw error;
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

      const outcome = await this.executor.run(job, workspace);
      const finished = new Date().toISOString();
      const terminal: JobRecord = {
        ...current,
        status: outcome.result.status,
        exitCode: outcome.exitCode,
        finishedAt: finished,
        updatedAt: finished,
      };
      try {
        await this.store.save(terminal);
      } catch {
        await this.outputStore.fail(job.id, new RelayError("OUTPUT_WRITE_FAILED", "Terminal job state could not be persisted", 500)).catch(() => undefined);
        return;
      }
      await this.outputStore.complete(job.id, terminal.status).catch(async () => {
        await this.outputStore.fail(job.id, new RelayError("OUTPUT_WRITE_FAILED", "Terminal output completion failed", 500)).catch(() => undefined);
      });
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
        if (relayError.code === "OUTPUT_WRITE_FAILED") {
          await this.outputStore.fail(job.id, relayError).catch(() => undefined);
        } else {
          await this.outputStore.complete(job.id, terminal.status).catch(async () => {
            await this.outputStore.fail(job.id, new RelayError("OUTPUT_WRITE_FAILED", "Terminal output completion failed", 500)).catch(() => undefined);
          });
        }
      } catch {
        await this.outputStore.fail(job.id, relayError).catch(() => undefined);
      }
    } finally {
      if (this.activeJobId === job.id) this.activeJobId = undefined;
    }
  }
}
