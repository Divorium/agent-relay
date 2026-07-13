import type { IncomingMessage, ServerResponse } from "node:http";
import { RelayError } from "../contracts/errors.js";

export async function readJson(req: IncomingMessage, maxBytes = 64_000): Promise<unknown> {
  const chunks: any[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > maxBytes) throw new RelayError("INVALID_REQUEST", "Request body is too large", 413);
    chunks.push(buffer);
  }
  if (bytes === 0) throw new RelayError("INVALID_REQUEST", "Request body is required", 400);
  const body = Buffer.concat(chunks, bytes).toString("utf8");
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
