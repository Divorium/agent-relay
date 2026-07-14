export const EXECUTION_MODES = ["implement", "revise", "finalize"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export interface CreateJobRequest {
  requestId: string;
  workspace: string;
  planPath: string;
  mode: ExecutionMode;
}

export type JobStatus =
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "interrupted";

export interface JobRecord {
  id: string;
  request: CreateJobRequest;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  errorCode?: string;
  errorMessage?: string;
  resultPath: string;
  outputPath: string;
}
