export interface CreateJobRequest {
  requestId: string;
  workspace: string;
  planPath: string;
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
