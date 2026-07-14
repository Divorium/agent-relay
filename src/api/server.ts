import { createServer } from "node:http";
import { RelayError } from "../contracts/errors.js";
import { validateCreateJobRequest } from "../contracts/validators.js";
import { requireBearerToken } from "../security/auth.js";
import type { AppConfig } from "../config/config.js";
import type { JobService } from "../application/job-service.js";
import { readJson, sendJson } from "./http.js";
import { streamJobLog } from "./log-stream.js";

export function createRelayServer(config: AppConfig, jobs: JobService) {
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
      const logMatch = /^\/v1\/jobs\/([A-Za-z0-9-]+)\/logs$/.exec(url.pathname);
      if (req.method === "GET" && logMatch) {
        await streamJobLog(res, jobs, logMatch[1]!);
        return;
      }
      const match = /^\/v1\/jobs\/([A-Za-z0-9-]+)$/.exec(url.pathname);
      if (req.method === "GET" && match) {
        sendJson(res, 200, await jobs.get(match[1]!));
        return;
      }
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Route not found" } });
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const relayError = error instanceof RelayError ? error : new RelayError("INTERNAL_ERROR", "Internal server error", 500);
      sendJson(res, relayError.statusCode, { error: { code: relayError.code, message: relayError.message } });
    }
  });
}
