import type { FastifyInstance } from 'fastify';
import type { RunMonitor } from '../../runs/run-monitor.js';
import type { WorkflowPersistence } from '../../workflow/runtime/types.js';
import type { WorkflowRunEvent } from '../../workflow/runtime/events.js';

export interface RunRoutesOptions {
  monitor?: RunMonitor;
  persistence?: WorkflowPersistence;
}

export async function registerRunRoutes(
  app: FastifyInstance,
  options: RunRoutesOptions = {},
): Promise<void> {
  app.get('/runs', async (_request, reply) => {
    if (options.monitor) return reply.send(options.monitor.list());
    const runs = (await options.persistence?.listRuns?.(50)) ?? [];
    return reply.send(runs);
  });

  app.get<{ Params: { runId: string } }>('/runs/:runId', async (request, reply) => {
    const run = options.monitor?.get(request.params.runId);
    if (run) return reply.send(run);
    const persisted = await options.persistence?.getRun?.(request.params.runId);
    if (persisted) return reply.send(persisted);
    return reply.code(404).send({ error: 'Run 不存在' });
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
