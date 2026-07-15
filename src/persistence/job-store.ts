import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JobRecord } from "../contracts/job.js";

export class JobStore {
  constructor(private readonly stateDir: string) {}

  private jobsDir(): string { return join(this.stateDir, "jobs"); }
  private path(id: string): string { return join(this.jobsDir(), `${id}.json`); }
  private indexPath(): string { return join(this.stateDir, "request-index.json"); }

  async init(): Promise<void> { await mkdir(this.jobsDir(), { recursive: true }); }

  async save(job: JobRecord): Promise<void> {
    await this.init();
    const target = this.path(job.id);
    const temp = `${target}.tmp`;
    await writeFile(temp, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, target);
  }

  async remove(id: string): Promise<void> {
    await rm(this.path(id), { force: true });
  }

  async get(id: string): Promise<JobRecord | undefined> {
    try { return JSON.parse(await readFile(this.path(id), "utf8")) as JobRecord; }
    catch (error: any) { if (error?.code === "ENOENT") return undefined; throw error; }
  }

  async findByRequestId(requestId: string): Promise<JobRecord | undefined> {
    try {
      const index = JSON.parse(await readFile(this.indexPath(), "utf8")) as Record<string, string>;
      const id = index[requestId];
      return id ? this.get(id) : undefined;
    } catch (error: any) { if (error?.code === "ENOENT") return undefined; throw error; }
  }

  async markRunningJobsInterrupted(): Promise<number> {
    await this.init();
    let count = 0;
    for (const name of await readdir(this.jobsDir())) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      const job = await this.get(id);
      if (!job || (job.status !== "accepted" && job.status !== "running")) continue;
      const now = new Date().toISOString();
      await this.save({
        ...job,
        status: "interrupted",
        updatedAt: now,
        finishedAt: now,
        errorCode: "INTERRUPTED",
        errorMessage: "Agent Relay restarted before the job reached a terminal state",
      });
      count += 1;
    }
    return count;
  }

  async index(job: JobRecord): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    const indexPath = this.indexPath();
    let index: Record<string, string> = {};
    try { index = JSON.parse(await readFile(indexPath, "utf8")); } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
    index[job.request.requestId] = job.id;
    const temp = `${indexPath}.tmp`;
    await writeFile(temp, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, indexPath);
  }

  async removeRequestId(requestId: string, expectedJobId: string): Promise<void> {
    const indexPath = this.indexPath();
    let index: Record<string, string>;
    try {
      index = JSON.parse(await readFile(indexPath, "utf8")) as Record<string, string>;
    } catch (error: any) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (index[requestId] !== expectedJobId) return;
    delete index[requestId];
    const temp = `${indexPath}.tmp`;
    await writeFile(temp, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, indexPath);
  }
}
