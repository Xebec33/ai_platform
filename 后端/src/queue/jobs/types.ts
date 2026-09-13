import type { JsonObject } from '@ai-workflow/shared-types';

export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export interface WorkflowJobPayload {
  variables: JsonObject;
  timeoutMs?: number;
}

export interface EnqueueWorkflowJobInput {
  id: string;
  runId: string;
  workflowId: string;
  payload: WorkflowJobPayload;
  maxAttempts?: number;
  availableAt?: Date;
}

export interface WorkflowJob {
  id: string;
  runId: string;
  workflowId: string;
  status: JobStatus;
  payload: WorkflowJobPayload;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  lockedBy?: string;
  lockedUntil?: string;
  error?: string;
  errorCode?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

export interface JobFailureResult {
  retryScheduled: boolean;
  job: WorkflowJob;
}

export interface JobQueue {
  migrate?(): void | Promise<void>;
  close?(): void | Promise<void>;
  enqueue(input: EnqueueWorkflowJobInput): Promise<WorkflowJob>;
  claim(workerId: string, leaseMs: number): Promise<WorkflowJob | undefined>;
  renew(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  complete(
    jobId: string,
    status: Extract<JobStatus, 'SUCCESS' | 'CANCELLED'>,
    workerId?: string,
  ): Promise<WorkflowJob | undefined>;
  fail(
    jobId: string,
    error: string,
    errorCode: string,
    workerId?: string,
    retryDelayMs?: number,
  ): Promise<JobFailureResult | undefined>;
  cancel(jobId: string, workerId?: string): Promise<WorkflowJob | undefined>;
  get(jobId: string): Promise<WorkflowJob | undefined>;
  getByRunId(runId: string): Promise<WorkflowJob | undefined>;
}
