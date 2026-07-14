export interface ValidationResult {
  command: string;
  status: "passed" | "failed" | "skipped";
  exitCode?: number;
  details: string;
}

export interface CodexResult {
  schemaVersion: 1;
  requestId: string;
  summary: string;
  validation: ValidationResult[];
}
