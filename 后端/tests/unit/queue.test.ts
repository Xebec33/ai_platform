import { describe, expect, it, vi } from 'vitest';
import { createWorkflowDefinition } from '@ai-workflow/shared-types';
import { PostgresJobQueue } from '../../src/queue/jobs/postgres.js';
import { WorkflowWorker } from '../../src/queue/worker.js';
import type { WorkflowJob } from '../../src/queue/jobs/types.js';

function makeJob(overrides: Partial<WorkflowJob> = {}): WorkflowJob {
  const now = new Date().toISOString();
  return {
    id: 'job-1',
    runId: 'run-1',
    workflowId: 'wf-1',
    status: 'RUNNING',
    payload: { variables: { prompt: 'hello' } },
    attempts: 1,
    maxAttempts: 2,
    availableAt: now,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeJobRow(overrides: Partial<WorkflowJob> = {}): Record<string, unknown> {
  const job = makeJob(overrides);
  return {
    id: job.id,
    run_id: job.runId,
    workflow_id: job.workflowId,
    status: job.status,
    payload: job.payload,
    attempts: job.attempts,
    max_attempts: job.maxAttempts,
    available_at: new Date(job.availableAt),
    locked_by: job.lockedBy ?? null,
    locked_until: job.lockedUntil ? new Date(job.lockedUntil) : null,
    error: job.error ?? null,
    error_code: job.errorCode ?? null,
    created_at: new Date(job.createdAt),
    started_at: job.startedAt ? new Date(job.startedAt) : null,
    finished_at: job.finishedAt ? new Date(job.finishedAt) : null,
    updated_at: new Date(job.updatedAt),
  };
}

describe('PostgresJobQueue', () => {
  it('claims only one available job using a row-locking query', async () => {
    const query = vi.fn(async () => ({ rows: [makeJobRow()] }));
    const queue = new PostgresJobQueue({ query } as never);
    const job = await queue.claim('worker-1', 10_000);
    expect(job?.id).toBe('job-1');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE SKIP LOCKED'), [
      'worker-1',
      10_000,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('attempts < max_attempts'), [
      'worker-1',
      10_000,
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("error_code = COALESCE(error_code, 'MAX_ATTEMPTS_REACHED')"),
      ['worker-1', 10_000],
    );
  });

  it('schedules retry until max attempts and then marks the job failed', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: 'PENDING', attempts: 1 })] })
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: 'FAILED', attempts: 2 })] });
    const queue = new PostgresJobQueue({ query } as never);
    expect(
      (await queue.fail('job-1', 'temporary', 'WORKFLOW_FAILED', 'worker-1', 100)).retryScheduled,
    ).toBe(true);
    expect(
      (await queue.fail('job-1', 'permanent', 'WORKFLOW_FAILED', 'worker-1')).retryScheduled,
    ).toBe(false);
  });
});

describe('WorkflowWorker', () => {
  it('executes a claimed job and completes it', async () => {
    const job = makeJob();
    const queue = {
      claim: vi.fn(async () => job),
      complete: vi.fn(async () => ({ ...job, status: 'SUCCESS' as const })),
      fail: vi.fn(),
      renew: vi.fn(async () => true),
      cancel: vi.fn(),
      get: vi.fn(),
      getByRunId: vi.fn(),
    };
    const workflow = createWorkflowDefinition('wf-1', 'Queue Workflow');
    const persistence = {
      getWorkflow: vi.fn(async () => workflow),
      saveWorkflow: vi.fn(),
      saveRun: vi.fn(),
      saveNodeRun: vi.fn(),
      saveState: vi.fn(),
      saveCheckpoint: vi.fn(),
    };
    const worker = new WorkflowWorker(queue, persistence, undefined, {
      workerId: 'worker-1',
      leaseMs: 1000,
    });
    expect(await worker.runOnce()).toBe(true);
    expect(queue.complete).toHaveBeenCalledWith('job-1', 'SUCCESS', 'worker-1');
  });

  it('respects concurrency and cancels an active job', async () => {
    const job = makeJob();
    const queue = {
      claim: vi.fn(async () => job),
      complete: vi.fn(async () => ({ ...job, status: 'CANCELLED' as const })),
      fail: vi.fn(),
      renew: vi.fn(async () => true),
      cancel: vi.fn(async () => ({ ...job, status: 'CANCELLED' as const })),
      get: vi.fn(),
      getByRunId: vi.fn(),
    };
    const workflow = createWorkflowDefinition('wf-1', 'Queue Workflow');
    const persistence = {
      getWorkflow: vi.fn(async () => workflow),
      saveWorkflow: vi.fn(),
      saveRun: vi.fn(),
      saveNodeRun: vi.fn(),
      saveState: vi.fn(),
      saveCheckpoint: vi.fn(),
    };
    const worker = new WorkflowWorker(queue, persistence, undefined, {
      workerId: 'worker-1',
      concurrency: 1,
      leaseMs: 1000,
      agentExecutor: async () => new Promise(() => {}),
    });
    const running = worker.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await worker.runOnce()).toBe(false);
    await worker.cancel('job-1');
    await Promise.race([
      running,
      new Promise((_, reject) => setTimeout(() => reject(new Error('worker did not stop')), 1000)),
    ]);
    expect(queue.cancel).toHaveBeenCalledWith('job-1', 'worker-1');
  });
});
