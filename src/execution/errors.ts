export type CodexExecutionErrorCode =
  | "INVALID_CONFIGURATION"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_OUTSIDE_ROOT"
  | "INVALID_PLAN"
  | "CODEX_FAILED"
  | "CODEX_TIMEOUT";

export class CodexExecutionError extends Error {
  constructor(
    readonly code: CodexExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CodexExecutionError";
  }
}
