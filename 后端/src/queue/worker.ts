import { randomUUID } from 'node:crypto';
import type { RunMonitor } from '../runs/run-monitor.js';
import { createWorkflowRuntime } from '../workflow/runtime/index.js';
import type { WorkflowPersistence, WorkflowRuntimeOptions } from '../workflow/runtime/types.js';
import type { JobQueue, WorkflowJob } from './jobs/types.js';

export interface WorkflowWorkerOptions {
  workerId?: string;
  concurrency?: number;
  leaseMs?: number;
  pollIntervalMs?: number;
  retryDelayMs?: number;
  maxJobAttempts?: number;
  maxAgentRetries?: number;
  agentTimeoutMs?: number;
  workflowTimeoutMs?: number;
  agentExecutor?: WorkflowRuntimeOptions['agentExecutor'];
  agentRegistry?: WorkflowRuntimeOptions['agentRegistry'];
  toolRegistry?: WorkflowRuntimeOptions['toolRegistry'];
  workspaceRoot?: string;
  onError?: (error: unknown) => void;
}

export class WorkflowWorker {
  private readonly workerId: string;
  private readonly concurrency: number;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly retryDelayMs: number;
  private readonly workflowTimeoutMs: number | undefined;
  private readonly onError: (error: unknown) => void;
  private pollInFlight = false;
  private pollFailureCount = 0;
  private nextPollAt = 0;
  private readonly runtimeOptions: Pick<
    WorkflowRuntimeOptions,
    'agentTimeoutMs' | 'maxAgentRetries' | 'agentExecutor' | 'agentRegistry' | 'toolRegistry' | 'workspaceRoot'
  >;
  private readonly active = new Map<
    string,
    { job: WorkflowJob; controller: AbortController; promise: Promise<void> }
  >();
  private timer: ReturnType<typeof setInterval> | undefined;
  private started = false;
  private stopping = false;

  constructor(
    private readonly queue: JobQueue,
    private readonly persistence: WorkflowPersistence,
    private readonly monitor: RunMonitor | undefined,
    options: WorkflowWorkerOptions = {},
  ) {
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.concurrency = positiveInteger(options.concurrency ?? 1, 'concurrency');
    this.leaseMs = positiveInteger(options.leaseMs ?? 30_000, 'leaseMs');
    this.pollIntervalMs = positiveInteger(options.pollIntervalMs ?? 250, 'pollIntervalMs');
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 1_000);
    this.workflowTimeoutMs = options.workflowTimeoutMs;
    this.onError = options.onError ?? ((error) => console.error('Workflow worker error', error));
    this.runtimeOptions = {
      agentTimeoutMs: options.agentTimeoutMs,
      maxAgentRetries: options.maxAgentRetries,
      agentExecutor: options.agentExecutor,
      agentRegistry: options.agentRegistry,
      toolRegistry: options.toolRegistry,
      workspaceRoot: options.workspaceRoot,
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    await this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const active of this.active.values()) active.controller.abort();
    await Promise.all([...this.active.values()].map((item) => item.promise));
    this.active.clear();
  }

  async cancel(jobId: string): Promise<WorkflowJob | undefined> {
    const active = this.active.get(jobId);
    const cancelled = await this.queue.cancel(jobId, active ? this.workerId : undefined);
    if (active) active.controller.abort();
    return cancelled;
  }

  async runOnce(): Promise<boolean> {
    if (this.stopping) return false;
    if (this.active.size >= this.concurrency) return false;
    const job = await this.queue.claim(this.workerId, this.leaseMs);
    if (!job) return false;
    const controller = new AbortController();
    const promise = this.process(job, controller).finally(() => {
      this.active.delete(job.id);
    });
    this.active.set(job.id, { job, controller, promise });
    await promise;
    return true;
  }

  private async poll(): Promise<void> {
    if (this.stopping || this.pollInFlight || Date.now() < this.nextPollAt) return;
    this.pollInFlight = true;
    try {
      while (!this.stopping && this.active.size < this.concurrency) {
        const job = await this.queue.claim(this.workerId, this.leaseMs);
        this.pollFailureCount = 0;
        if (!job) return;
        const controller = new AbortController();
        const promise = this.process(job, controller).finally(() => {
          this.active.delete(job.id);
        });
        this.active.set(job.id, { job, controller, promise });
      }
    } catch (error) {
      this.pollFailureCount += 1;
      const backoffMs = Math.min(
        30_000,
        this.pollIntervalMs * 2 ** Math.min(this.pollFailureCount - 1, 7),
      );
      this.nextPollAt = Date.now() + Math.max(backoffMs, this.pollIntervalMs);
      this.onError(error);
    } finally {
      this.pollInFlight = false;
    }
  }

  private async process(job: WorkflowJob, controller: AbortController): Promise<void> {
    let renewalTimer: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timeoutTriggered = false;
    try {
      const workflow = await this.persistence.getWorkflow?.(job.workflowId);
      if (!workflow) {
        await this.failJob(job, 'Workflow 不存在：' + job.workflowId, 'WORKFLOW_NOT_FOUND');
        return;
      }
      renewalTimer = setInterval(() => {
        void this.queue
          .renew(job.id, this.workerId, this.leaseMs)
          .catch((error) => this.onError(error));
      }, Math.max(1, Math.floor(this.leaseMs / 2)));
      const timeoutMs = job.payload.timeoutMs;
      timeout =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timeoutTriggered = true;
              controller.abort();
            }, timeoutMs);
      const runtime = createWorkflowRuntime(workflow, {
        ...this.runtimeOptions,
        persistence: this.persistence,
        runMonitor: this.monitor,
        runIdFactory: () => job.runId,
        workflowTimeoutMs: timeoutMs ?? this.workflowTimeoutMs,
      });
      const result = await runtime.execute({
        variables: job.payload.variables,
        signal: controller.signal,
      });
      if (timeoutTriggered) {
        await this.failJob(job, `Job 执行超时（${timeoutMs}ms）`, 'JOB_TIMEOUT');
      } else if (result.status === 'SUCCESS') {
        await this.completeJob(job, 'SUCCESS');
      } else if (result.status === 'CANCELLED') {
        await this.completeJob(job, 'CANCELLED');
      } else {
        await this.failJob(
          job,
          result.error ?? 'Workflow 执行失败',
          result.errorCode ?? 'WORKFLOW_FAILED',
        );
      }
    } catch (error) {
      await this.failJob(
        job,
        error instanceof Error ? error.message : String(error),
        'WORKER_ERROR',
      );
    } finally {
      if (timeout) clearTimeout(timeout);
      if (renewalTimer) clearInterval(renewalTimer);
    }
  }

  private async completeJob(
    job: WorkflowJob,
    status: Extract<WorkflowJob['status'], 'SUCCESS' | 'CANCELLED'>,
  ): Promise<void> {
    try {
      await this.queue.complete(job.id, status, this.workerId);
    } catch (queueError) {
      this.onError(queueError);
    }
  }

  private async failJob(job: WorkflowJob, error: string, errorCode: string): Promise<void> {
    try {
      await this.queue.fail(job.id, error, errorCode, this.workerId, this.retryDelayMs);
    } catch (queueError) {
      this.onError(queueError);
    }
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`);
  return value;
}
