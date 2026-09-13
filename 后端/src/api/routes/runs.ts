import type { FastifyInstance } from 'fastify';
import type { RunMonitor } from '../../runs/run-monitor.js';
import type { WorkflowPersistence } from '../../workflow/runtime/types.js';
import type { WorkflowRunEvent } from '../../workflow/runtime/events.js';
import type { JobQueue, WorkflowJob } from '../../queue/jobs/types.js';

export interface RunRoutesOptions {
  monitor?: RunMonitor;
  persistence?: WorkflowPersistence;
  queue?: JobQueue;
  cancelJob?: (jobId: string) => Promise<WorkflowJob | undefined>;
}

export async function registerRunRoutes(
  app: FastifyInstance,
  options: RunRoutesOptions = {},
): Promise<void> {
  app.get('/runs', async (_request, reply) => {
    const persisted = (await options.persistence?.listRuns?.(50)) ?? [];
    const inMemory = options.monitor?.list() ?? [];
    const merged = new Map(persisted.map((run) => [run.id, run]));
    for (const run of inMemory) merged.set(run.id, run);
    return reply.send(
      [...merged.values()]
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .slice(0, 50),
    );
  });

  app.get<{ Params: { runId: string } }>('/runs/:runId', async (request, reply) => {
    const run = options.monitor?.get(request.params.runId);
    if (run) return reply.send(run);
    const persisted = await options.persistence?.getRun?.(request.params.runId);
    if (persisted) return reply.send(persisted);
    return reply.code(404).send({ error: 'Run 不存在' });
  });

  app.get<{ Params: { runId: string } }>('/runs/:runId/job', async (request, reply) => {
    const job = await options.queue?.getByRunId(request.params.runId);
    if (!job) return reply.code(404).send({ error: 'Job 不存在' });
    return reply.send(job);
  });

  app.post<{ Params: { runId: string } }>('/runs/:runId/cancel', async (request, reply) => {
    if (!options.queue) return reply.code(503).send({ error: 'Job Queue 未配置' });
    const job = await options.queue.getByRunId(request.params.runId);
    if (!job) return reply.code(404).send({ error: 'Job 不存在' });
    const cancelled = options.cancelJob
      ? await options.cancelJob(job.id)
      : await options.queue.cancel(job.id);
    if (!cancelled) return reply.code(409).send({ error: 'Job 已完成或正在被其他 Worker 执行' });
    return reply.send(cancelled);
  });

  app.get<{ Params: { runId: string } }>('/runs/:runId/events', async (request, reply) => {
    const { runId } = request.params;
    const monitor = options.monitor;
    if (!monitor) return reply.code(503).send({ error: '运行监控未配置' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event: WorkflowRunEvent): void => {
      reply.raw.write(`id: ${event.id}\n`);
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    for (const event of monitor.events.history(runId)) send(event);

    const unsubscribe = monitor.subscribe(runId, send);
    request.raw.on('close', () => {
      unsubscribe();
      reply.raw.end();
    });
  });
}
