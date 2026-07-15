export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "WORKSPACE_OUTSIDE_ROOT"
  | "WORKSPACE_NOT_FOUND"
  | "JOB_ALREADY_RUNNING"
  | "JOB_PREPARATION_FAILED"
  | "REQUEST_ID_CONFLICT"
  | "JOB_NOT_FOUND"
  | "CODEX_FAILED"
  | "CODEX_TIMEOUT"
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
