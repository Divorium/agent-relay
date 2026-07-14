import { createServer } from "node:http";
import { RelayError } from "../contracts/errors.js";
import { validateCreateJobRequest } from "../contracts/validators.js";
import { requireBearerToken } from "../security/auth.js";
import type { AppConfig } from "../config/config.js";
import type { JobService } from "../application/job-service.js";
import type { OutputStore } from "../persistence/output-store.js";
import { readJson, sendJson } from "./http.js";

function parseOffset(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) {
    throw new RelayError("INVALID_REQUEST", "offset is required and must contain decimal digits only", 400);
  }
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RelayError("INVALID_REQUEST", "offset must be a non-negative safe integer", 400);
  }
  return offset;
}

async function writeChunk(res: import("node:http").ServerResponse, chunk: Uint8Array): Promise<void> {
  if (chunk.length === 0) return;
  if (!res.write(chunk)) {
    await new Promise<void>((resolve, reject) => {
      const onDrain = (): void => {
        cleanup();
        resolve();
      };
      const onClose = (): void => {
        cleanup();
        reject(new RelayError("OUTPUT_READ_FAILED", "Output reader was cancelled", 500));
      };
      const cleanup = (): void => {
        res.off("drain", onDrain);
        res.off("close", onClose);
      };
      res.once("drain", onDrain);
      res.once("close", onClose);
    });
  }
}

async function streamOutput(
  outputStore: OutputStore,
  job: Awaited<ReturnType<JobService["get"]>>,
  initialOffset: number,
  res: import("node:http").ServerResponse,
): Promise<void> {
  const controller = new AbortController();
  const onClose = (): void => controller.abort();
  res.on("close", onClose);
  res.on("error", onClose);
  try {
    await outputStore.attach(job);
    let offset = initialOffset;
    let snapshot = outputStore.peek(job.id);
    if (offset > snapshot.committedLength) {
      throw new RelayError("INVALID_REQUEST", "offset is beyond committed output", 416);
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("cache-control", "no-store");
    res.flushHeaders();

    while (!controller.signal.aborted) {
      snapshot = outputStore.peek(job.id);
      if (offset < snapshot.committedLength) {
        const chunk = await outputStore.read(job.id, offset);
        if (chunk.length === 0) continue;
        await writeChunk(res, chunk);
        offset += chunk.length;
        continue;
      }
      if (snapshot.terminal?.kind === "error") throw snapshot.terminal.error;
      if (snapshot.terminal?.kind === "clean") {
        res.end();
        return;
      }
      await outputStore.waitForChange(job.id, snapshot.version, controller.signal);
    }
  } finally {
    res.off("close", onClose);
    res.off("error", onClose);
    if (!res.writableEnded && !res.destroyed) {
      res.destroy();
    }
  }
}

export function createRelayServer(config: AppConfig, jobs: JobService, outputStore: OutputStore) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://agent-relay.local");
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }
      requireBearerToken(req.headers.authorization, config.relayToken);
      if (req.method === "POST" && url.pathname === "/v1/jobs") {
        const request = validateCreateJobRequest(await readJson(req));
        sendJson(res, 202, await jobs.create(request));
        return;
      }
      const outputMatch = /^\/v1\/jobs\/([A-Za-z0-9-]+)\/output$/.exec(url.pathname);
      if (req.method === "GET" && outputMatch) {
        const job = await jobs.get(outputMatch[1]!);
        const offset = parseOffset(url.searchParams.get("offset"));
        await streamOutput(outputStore, job, offset, res);
        return;
      }
      const match = /^\/v1\/jobs\/([A-Za-z0-9-]+)$/.exec(url.pathname);
      if (req.method === "GET" && match) {
        sendJson(res, 200, await jobs.get(match[1]!));
        return;
      }
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Route not found" } });
    } catch (error) {
      const relayError = error instanceof RelayError ? error : new RelayError("INTERNAL_ERROR", "Internal server error", 500);
      if (relayError.code === "OUTPUT_READ_FAILED" && res.headersSent) {
        res.destroy(relayError);
        return;
      }
      sendJson(res, relayError.statusCode, { error: { code: relayError.code, message: relayError.message } });
    }
  });
}
