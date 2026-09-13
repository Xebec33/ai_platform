import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoute } from './api/routes/health.js';
import { registerWorkflowRoutes } from './api/routes/workflows.js';
import { registerRunRoutes } from './api/routes/runs.js';
import {
  createPostgresJobQueueFromEnv,
  createPostgresPersistenceFromEnv,
  createWorkflowWorkerOptionsFromEnv,
} from './config/persistence.js';
import { InMemoryRunMonitor } from './runs/run-monitor.js';
import type { RunMonitor } from './runs/run-monitor.js';
import type { WorkflowPersistence } from './workflow/runtime/types.js';
import { createDefaultToolRegistry, type ToolRegistry } from './tools/index.js';
import { WorkflowWorker, type WorkflowWorkerOptions } from './queue/worker.js';
import type { JobQueue } from './queue/jobs/types.js';

export interface AppOptions {
  logger?: boolean;
  persistence?: WorkflowPersistence;
  monitor?: RunMonitor | null;
  toolRegistry?: ToolRegistry;
  workspaceRoot?: string;
  queue?: JobQueue;
  asyncRuns?: boolean;
  worker?: boolean;
  workerOptions?: WorkflowWorkerOptions;
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const persistence =
    options.persistence ??
    (process.env.NODE_ENV === 'test' ? undefined : createPostgresPersistenceFromEnv());
  const monitor =
    options.monitor === undefined ? new InMemoryRunMonitor() : (options.monitor ?? undefined);
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const toolRegistry = options.toolRegistry ?? createDefaultToolRegistry(workspaceRoot);
  const queue =
    options.queue ??
    (process.env.NODE_ENV === 'test' ? undefined : createPostgresJobQueueFromEnv());
  const workerOptions =
    options.workerOptions ??
    (process.env.NODE_ENV === 'test' ? undefined : createWorkflowWorkerOptionsFromEnv());
  const worker =
    queue && persistence && (options.worker ?? true)
      ? new WorkflowWorker(queue, persistence, monitor, {
          ...workerOptions,
          toolRegistry,
          workspaceRoot,
        })
      : undefined;

  if (persistence?.migrate) await persistence.migrate();
  if (queue?.migrate) await queue.migrate();
  await app.register(cors, { origin: true });
  await registerHealthRoute(app);
  await registerWorkflowRoutes(app, {
    persistence,
    monitor,
    toolRegistry,
    workspaceRoot,
    queue,
    asyncRuns: options.asyncRuns ?? Boolean(queue),
    maxJobAttempts: workerOptions?.maxJobAttempts,
    jobTimeoutMs: workerOptions?.workflowTimeoutMs,
  });
  await registerRunRoutes(app, {
    persistence,
    monitor,
    queue,
    cancelJob: worker ? worker.cancel.bind(worker) : undefined,
  });
  if (worker) await worker.start();
  app.addHook('onClose', async () => {
    await worker?.stop();
    if (persistence?.close) await persistence.close();
    await queue?.close?.();
  });
  return app;
}
