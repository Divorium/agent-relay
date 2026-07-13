import { RelayError } from "./errors.js";
import { EXECUTION_MODES, type CreateJobRequest } from "./job.js";
import type { CodexResult, ValidationResult } from "./result.js";
import { assertNoSensitiveResult } from "../security/redaction.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RelayError("INVALID_REQUEST", `${name} must be an object`, 400);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || CONTROL_CHARACTERS.test(value)) {
    throw new RelayError("INVALID_REQUEST", `${name} must be a non-empty string up to ${max} characters`, 400);
  }
  return value;
}

function stringArray(value: unknown, name: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new RelayError("INVALID_REQUEST", `${name} must be an array with at most ${maxItems} items`, 400);
  }
  return value.map((item, index) => requiredString(item, `${name}[${index}]`, maxLength));
}

export function validateCreateJobRequest(value: unknown): CreateJobRequest {
  const object = asObject(value, "request");
  const allowed = new Set(["requestId", "workspace", "planPath", "mode", "reviewFindings"]);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new RelayError("INVALID_REQUEST", `Unknown field: ${key}`, 400);
  }

  const requestId = requiredString(object.requestId, "requestId", 128);
  if (!REQUEST_ID.test(requestId)) throw new RelayError("INVALID_REQUEST", "requestId has invalid format", 400);

  const workspace = requiredString(object.workspace, "workspace", 512);
  if (!RELATIVE_PATH.test(workspace)) throw new RelayError("INVALID_REQUEST", "workspace must be a safe relative path", 400);

  const planPath = requiredString(object.planPath, "planPath", 512);
  if (!RELATIVE_PATH.test(planPath) || !planPath.endsWith(".md")) {
    throw new RelayError("INVALID_REQUEST", "planPath must be a safe relative Markdown path", 400);
  }

  if (typeof object.mode !== "string" || !EXECUTION_MODES.includes(object.mode as never)) {
    throw new RelayError("INVALID_REQUEST", "mode must be implement, revise, or finalize", 400);
  }

  const request: CreateJobRequest = { requestId, workspace, planPath, mode: object.mode as CreateJobRequest["mode"] };
  if (object.reviewFindings !== undefined) request.reviewFindings = stringArray(object.reviewFindings, "reviewFindings", 50, 2000);
  return request;
}

function validateValidation(value: unknown, index: number): ValidationResult {
  const object = asObject(value, `validation[${index}]`);
  const command = requiredString(object.command, `validation[${index}].command`, 500);
  if (!["passed", "failed", "skipped"].includes(String(object.status))) {
    throw new RelayError("RESULT_INVALID", `validation[${index}].status is invalid`, 422);
  }
  const details = requiredString(object.details, `validation[${index}].details`, 2000);
  const result: ValidationResult = { command, status: object.status as ValidationResult["status"], details };
  if (object.exitCode !== undefined) {
    if (!Number.isInteger(object.exitCode) || Number(object.exitCode) < 0 || Number(object.exitCode) > 255) {
      throw new RelayError("RESULT_INVALID", `validation[${index}].exitCode is invalid`, 422);
    }
    result.exitCode = Number(object.exitCode);
  }
  return result;
}

export function validateCodexResult(value: unknown, expectedRequestId: string): CodexResult {
  try { assertNoSensitiveResult(value); } catch { throw new RelayError("RESULT_INVALID", "Result contains sensitive data", 422); }
  const object = asObject(value, "result");
  const allowed = new Set(["schemaVersion", "requestId", "status", "shouldCommit", "commitMessage", "summary", "validation", "blockers", "limitations"]);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new RelayError("RESULT_INVALID", `Unknown result field: ${key}`, 422);
  }
  if (object.schemaVersion !== 1) throw new RelayError("RESULT_INVALID", "Unsupported schemaVersion", 422);
  if (object.requestId !== expectedRequestId) throw new RelayError("RESULT_INVALID", "Result requestId does not match the job", 422);
  if (object.status !== "completed" && object.status !== "blocked") throw new RelayError("RESULT_INVALID", "Invalid result status", 422);
  if (typeof object.shouldCommit !== "boolean") throw new RelayError("RESULT_INVALID", "shouldCommit must be boolean", 422);

  const summary = requiredString(object.summary, "summary", 4000);
  const validation = Array.isArray(object.validation) && object.validation.length <= 100
    ? object.validation.map(validateValidation)
    : (() => { throw new RelayError("RESULT_INVALID", "validation must be an array with at most 100 items", 422); })();
  const blockers = stringArray(object.blockers, "blockers", 50, 2000);
  const limitations = stringArray(object.limitations, "limitations", 50, 2000);

  const result: CodexResult = {
    schemaVersion: 1,
    requestId: expectedRequestId,
    status: object.status,
    shouldCommit: object.shouldCommit,
    summary,
    validation,
    blockers,
    limitations,
  };

  if (object.status === "blocked" && object.shouldCommit) throw new RelayError("RESULT_INVALID", "Blocked work cannot be committed", 422);
  if (object.status === "completed" && object.shouldCommit) {
    const commitMessage = requiredString(object.commitMessage, "commitMessage", 120);
    if (commitMessage.includes("\n") || commitMessage.includes("\r")) throw new RelayError("RESULT_INVALID", "commitMessage must be one line", 422);
    result.commitMessage = commitMessage;
  } else if (object.commitMessage !== undefined) {
    throw new RelayError("RESULT_INVALID", "commitMessage is only allowed when a commit is requested", 422);
  }
  return result;
}
