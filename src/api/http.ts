import type { IncomingMessage, ServerResponse } from "node:http";
import { RelayError } from "../contracts/errors.js";

export async function readJson(req: IncomingMessage, maxBytes = 64_000): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > maxBytes) throw new RelayError("INVALID_REQUEST", "Request body is too large", 413);
  }
  if (!body) throw new RelayError("INVALID_REQUEST", "Request body is required", 400);
  try { return JSON.parse(body); }
  catch { throw new RelayError("INVALID_REQUEST", "Request body must be valid JSON", 400); }
}

export function sendJson(res: ServerResponse, statusCode: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}
