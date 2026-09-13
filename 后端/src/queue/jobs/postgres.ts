import type { Pool, QueryResultRow } from 'pg';
import type { JsonObject } from '@ai-workflow/shared-types';
import type { EnqueueWorkflowJobInput, JobFailureResult, JobQueue, WorkflowJob } from './types.js';

interface JobRow extends QueryResultRow {
  id: string;
  run_id: string;
  workflow_id: string;
  status: WorkflowJob['status'];
  payload: { variables?: JsonObject; timeoutMs?: number };
  attempts: number;
  max_attempts: number;
  available_at: Date;
  locked_by: string | null;
  locked_until: Date | null;
  error: string | null;
  error_code: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  updated_at: Date;
}

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(jobQueueSchema);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async enqueue(input: EnqueueWorkflowJobInput): Promise<WorkflowJob> {
    const result = await this.pool.query<JobRow>(
      `INSERT INTO workflow_jobs
         (id, run_id, workflow_id, status, payload, attempts, max_attempts, available_at)
       VALUES ($1, $2, $3, 'PENDING', $4::jsonb, 0, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         payload = EXCLUDED.payload,
         max_attempts = EXCLUDED.max_attempts,
         available_at = EXCLUDED.available_at,
         updated_at = NOW()
       RETURNING *`,
      [
        input.id,
        input.runId,
        input.workflowId,
        JSON.stringify(input.payload),
        normalizeMaxAttempts(input.maxAttempts),
        input.availableAt ?? new Date(),
      ],
    );
    return toJob(result.rows[0]!);
  }

  async claim(workerId: string, leaseMs: number): Promise<WorkflowJob | undefined> {
    const result = await this.pool.query<JobRow>(
      `WITH exhausted AS (
         UPDATE workflow_jobs
         SET status = 'FAILED',
             locked_by = NULL,
             locked_until = NULL,
             error = COALESCE(error, 'Job lease expired after max attempts'),
             error_code = COALESCE(error_code, 'MAX_ATTEMPTS_REACHED'),
             finished_at = NOW(),
             updated_at = NOW()
         WHERE status = 'RUNNING'
           AND locked_until IS NOT NULL
           AND locked_until < NOW()
           AND attempts >= max_attempts
         RETURNING id
       ), candidate AS (
         SELECT id
         FROM workflow_jobs
         WHERE attempts < max_attempts
           AND ((status = 'PENDING' AND available_at <= NOW())
             OR (status = 'RUNNING' AND locked_until < NOW()))
         ORDER BY available_at, created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE workflow_jobs AS job
       SET status = 'RUNNING',
           attempts = job.attempts + 1,
           locked_by = $1,
           locked_until = NOW() + ($2 * INTERVAL '1 millisecond'),
           started_at = COALESCE(job.started_at, NOW()),
           updated_at = NOW()
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING job.*`,
      [workerId, positiveLease(leaseMs)],
    );
    return result.rows[0] ? toJob(result.rows[0]) : undefined;
  }

  async renew(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE workflow_jobs
       SET locked_until = NOW() + ($3 * INTERVAL '1 millisecond'), updated_at = NOW()
       WHERE id = $1 AND status = 'RUNNING' AND locked_by = $2`,
      [jobId, workerId, positiveLease(leaseMs)],
    );
    return result.rowCount === 1;
  }

  async complete(
    jobId: string,
    status: Extract<WorkflowJob['status'], 'SUCCESS' | 'CANCELLED'>,
    workerId?: string,
  ): Promise<WorkflowJob | undefined> {
    const result = await this.pool.query<JobRow>(
      `UPDATE workflow_jobs
       SET status = $2,
           locked_by = NULL,
           locked_until = NULL,
           finished_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND status = 'RUNNING'
         AND ($3::text IS NULL OR locked_by = $3)
       RETURNING *`,
      [jobId, status, workerId ?? null],
    );
    return result.rows[0] ? toJob(result.rows[0]) : undefined;
  }

  async fail(
    jobId: string,
    error: string,
    errorCode: string,
    workerId?: string,
    retryDelayMs = 0,
  ): Promise<JobFailureResult | undefined> {
    const result = await this.pool.query<JobRow>(
      `UPDATE workflow_jobs
       SET status = CASE WHEN attempts < max_attempts THEN 'PENDING' ELSE 'FAILED' END,
           available_at = CASE WHEN attempts < max_attempts
             THEN NOW() + ($5 * INTERVAL '1 millisecond') ELSE available_at END,
           locked_by = NULL,
           locked_until = NULL,
           error = $2,
           error_code = $3,
           finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE NOW() END,
           updated_at = NOW()
       WHERE id = $1
         AND status = 'RUNNING'
         AND ($4::text IS NULL OR locked_by = $4)
       RETURNING *`,
      [jobId, error, errorCode, workerId ?? null, Math.max(0, retryDelayMs)],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const job = toJob(row);
    return { retryScheduled: job.status === 'PENDING', job };
  }

  async cancel(jobId: string, workerId?: string): Promise<WorkflowJob | undefined> {
    const result = await this.pool.query<JobRow>(
      `UPDATE workflow_jobs
       SET status = 'CANCELLED',
           locked_by = NULL,
           locked_until = NULL,
           finished_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND status IN ('PENDING', 'RUNNING')
         AND ($2::text IS NULL OR locked_by = $2)
       RETURNING *`,
      [jobId, workerId ?? null],
    );
    return result.rows[0] ? toJob(result.rows[0]) : undefined;
  }

  async get(jobId: string): Promise<WorkflowJob | undefined> {
    const result = await this.pool.query<JobRow>('SELECT * FROM workflow_jobs WHERE id = $1', [
      jobId,
    ]);
    return result.rows[0] ? toJob(result.rows[0]) : undefined;
  }

  async getByRunId(runId: string): Promise<WorkflowJob | undefined> {
    const result = await this.pool.query<JobRow>(
      'SELECT * FROM workflow_jobs WHERE run_id = $1 ORDER BY created_at DESC LIMIT 1',
      [runId],
    );
    return result.rows[0] ? toJob(result.rows[0]) : undefined;
  }
}

export const jobQueueSchema = `
CREATE TABLE IF NOT EXISTS workflow_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts >= 1),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT,
  locked_until TIMESTAMPTZ,
  error TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workflow_jobs_claim_idx
  ON workflow_jobs (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS workflow_jobs_run_id_idx
  ON workflow_jobs (run_id);
`;

function toJob(row: JobRow): WorkflowJob {
  return {
    id: row.id,
    runId: row.run_id,
    workflowId: row.workflow_id,
    status: row.status,
    payload: {
      variables: row.payload.variables ?? {},
      ...(row.payload.timeoutMs === undefined ? {} : { timeoutMs: row.payload.timeoutMs }),
    },
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at.toISOString(),
    lockedBy: row.locked_by ?? undefined,
    lockedUntil: row.locked_until?.toISOString(),
    error: row.error ?? undefined,
    errorCode: row.error_code ?? undefined,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString(),
    finishedAt: row.finished_at?.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1) throw new Error('maxAttempts 必须是正整数');
  return value;
}

function positiveLease(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error('leaseMs 必须是正整数');
  return value;
}
