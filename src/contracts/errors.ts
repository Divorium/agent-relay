export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "WORKSPACE_OUTSIDE_ROOT"
  | "WORKSPACE_NOT_FOUND"
  | "JOB_ALREADY_RUNNING"
  | "REQUEST_ID_CONFLICT"
  | "JOB_NOT_FOUND"
  | "OUTPUT_PREPARATION_FAILED"
  | "OUTPUT_WRITE_FAILED"
  | "OUTPUT_READ_FAILED"
  | "CODEX_FAILED"
  | "CODEX_TIMEOUT"
  | "RESULT_MISSING"
  | "RESULT_INVALID"
  | "INTERNAL_ERROR";

export class RelayError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "RelayError";
  }
}
