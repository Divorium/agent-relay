import { RelayError } from "./errors.js";
import type { CreateJobRequest } from "./job.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;
const ACTIVE_PLAN_PATH = /^docs\/exec-plans\/active\/[A-Za-z0-9._-]+\.md$/;

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RelayError("INVALID_REQUEST", `${name} must be an object`, 400);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(object: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(object)) {
    if (!allowedSet.has(key)) throw new RelayError("INVALID_REQUEST", `Unknown field: ${key}`, 400);
  }
}

function requiredString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || CONTROL_CHARACTERS.test(value)) {
    throw new RelayError("INVALID_REQUEST", `${name} must be a non-empty string up to ${max} characters without control characters`, 400);
  }
  return value;
}

export function validateCreateJobRequest(value: unknown): CreateJobRequest {
  const object = asObject(value, "request");
  rejectUnknownFields(object, ["requestId", "workspace", "planPath"]);

  const requestId = requiredString(object.requestId, "requestId", 128);
  if (!REQUEST_ID.test(requestId)) throw new RelayError("INVALID_REQUEST", "requestId has invalid format", 400);

  const workspace = requiredString(object.workspace, "workspace", 512);
  if (!RELATIVE_PATH.test(workspace)) throw new RelayError("INVALID_REQUEST", "workspace must be a safe relative path", 400);

  const planPath = requiredString(object.planPath, "planPath", 512);
  if (!ACTIVE_PLAN_PATH.test(planPath)) {
    throw new RelayError("INVALID_REQUEST", "planPath must identify a Markdown file directly under docs/exec-plans/active", 400);
  }

  return { requestId, workspace, planPath };
}
