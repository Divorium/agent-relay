import { RelayError } from "./errors.js";
import { EXECUTION_MODES, type CreateJobRequest } from "./job.js";
import type { CodexResult, ValidationResult } from "./result.js";
import { assertNoSensitiveResult } from "../security/redaction.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;

type ErrorContext = "request" | "result";

function invalid(context: ErrorContext, message: string): RelayError {
  return context === "request"
    ? new RelayError("INVALID_REQUEST", message, 400)
    : new RelayError("RESULT_INVALID", message, 422);
}

function asObject(value: unknown, name: string, context: ErrorContext): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(context, `${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(object: Record<string, unknown>, allowed: readonly string[], context: ErrorContext, prefix: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(object)) {
    if (!allowedSet.has(key)) throw invalid(context, `Unknown ${prefix}field: ${key}`);
  }
}

function requiredString(value: unknown, name: string, max: number, context: ErrorContext): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || CONTROL_CHARACTERS.test(value)) {
    throw invalid(context, `${name} must be a non-empty string up to ${max} characters without control characters`);
  }
  return value;
}

function stringArray(value: unknown, name: string, maxItems: number, maxLength: number, context: ErrorContext): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw invalid(context, `${name} must be an array with at most ${maxItems} items`);
  }
  return value.map((item, index) => requiredString(item, `${name}[${index}]`, maxLength, context));
}

export function validateCreateJobRequest(value: unknown): CreateJobRequest {
  const object = asObject(value, "request", "request");
  rejectUnknownFields(object, ["requestId", "workspace", "planPath", "mode"], "request", "");

  const requestId = requiredString(object.requestId, "requestId", 128, "request");
  if (!REQUEST_ID.test(requestId)) throw invalid("request", "requestId has invalid format");

  const workspace = requiredString(object.workspace, "workspace", 512, "request");
  if (!RELATIVE_PATH.test(workspace)) throw invalid("request", "workspace must be a safe relative path");

  const planPath = requiredString(object.planPath, "planPath", 512, "request");
  if (!RELATIVE_PATH.test(planPath) || !planPath.endsWith(".md")) {
    throw invalid("request", "planPath must be a safe relative Markdown path");
  }

  if (typeof object.mode !== "string" || !EXECUTION_MODES.includes(object.mode as never)) {
    throw invalid("request", "mode must be implement, revise, or finalize");
  }

  return { requestId, workspace, planPath, mode: object.mode as CreateJobRequest["mode"] };
}

function validateValidation(value: unknown, index: number): ValidationResult {
  const object = asObject(value, `validation[${index}]`, "result");
  rejectUnknownFields(object, ["command", "status", "exitCode", "details"], "result", `validation[${index}].`);
  const command = requiredString(object.command, `validation[${index}].command`, 500, "result");
  if (!( ["passed", "failed", "skipped"] as const).includes(object.status as never)) {
    throw invalid("result", `validation[${index}].status is invalid`);
  }
  const details = requiredString(object.details, `validation[${index}].details`, 2000, "result");
  const result: ValidationResult = { command, status: object.status as ValidationResult["status"], details };
  if (object.exitCode !== undefined) {
    if (!Number.isInteger(object.exitCode) || Number(object.exitCode) < 0 || Number(object.exitCode) > 255) {
      throw invalid("result", `validation[${index}].exitCode is invalid`);
    }
    result.exitCode = Number(object.exitCode);
  }
  return result;
}

export function validateCodexResult(value: unknown, expectedRequestId: string): CodexResult {
  try { assertNoSensitiveResult(value); } catch { throw invalid("result", "Result contains sensitive data"); }
  const object = asObject(value, "result", "result");
  rejectUnknownFields(object, ["schemaVersion", "requestId", "status", "commitMessage", "summary", "validation", "blockers", "limitations"], "result", "result ");
  if (object.schemaVersion !== 1) throw invalid("result", "Unsupported schemaVersion");
  if (object.requestId !== expectedRequestId) throw invalid("result", "Result requestId does not match the job");
  if (object.status !== "completed" && object.status !== "blocked") throw invalid("result", "Invalid result status");

  const summary = requiredString(object.summary, "summary", 4000, "result");
  const validation = Array.isArray(object.validation) && object.validation.length <= 100
    ? object.validation.map(validateValidation)
    : (() => { throw invalid("result", "validation must be an array with at most 100 items"); })();
  const blockers = stringArray(object.blockers, "blockers", 50, 2000, "result");
  const limitations = stringArray(object.limitations, "limitations", 50, 2000, "result");

  const result: CodexResult = {
    schemaVersion: 1,
    requestId: expectedRequestId,
    status: object.status,
    summary,
    validation,
    blockers,
    limitations,
  };

  if (object.status === "completed") {
    const commitMessage = requiredString(object.commitMessage, "commitMessage", 120, "result");
    if (commitMessage.includes("\n") || commitMessage.includes("\r")) throw invalid("result", "commitMessage must be one line");
    result.commitMessage = commitMessage;
  } else if (object.commitMessage !== undefined) {
    throw invalid("result", "commitMessage is not allowed for blocked work");
  }
  return result;
}
