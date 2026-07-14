import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import type { JobService } from "../application/job-service.js";

const TERMINAL_STATUSES = new Set(["completed", "blocked", "failed", "timed_out", "interrupted"]);

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function streamJobLog(
  response: ServerResponse,
  jobs: JobService,
  jobId: string,
  pollIntervalMs = 250,
): Promise<void> {
  let disconnected = false;
  let offset = 0;
  response.statusCode = 200;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.on("close", () => { disconnected = true; });
  response.flushHeaders?.();

  while (!disconnected) {
    const job = await jobs.get(jobId);
    try {
      const content = await readFile(job.outputPath, "utf8");
      if (content.length > offset) {
        response.write(content.slice(offset));
        offset = content.length;
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }

    if (TERMINAL_STATUSES.has(job.status)) break;
    await delay(pollIntervalMs);
  }

  if (!disconnected) response.end();
}
