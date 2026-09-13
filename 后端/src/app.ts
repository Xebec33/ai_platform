import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoute } from './api/routes/health.js';
import { registerWorkflowRoutes } from './api/routes/workflows.js';
import { registerRunRoutes } from './api/routes/runs.js';
import { createPostgresPersistenceFromEnv } from './config/persistence.js';
import { InMemoryRunMonitor } from './runs/run-monitor.js';
import type { RunMonitor } from './runs/run-monitor.js';
import type { WorkflowPersistence } from './workflow/runtime/types.js';
import { createDefaultToolRegistry, type ToolRegistry } from './tools/index.js';

export interface AppOptions {
  logger?: boolean;
  persistence?: WorkflowPersistence;
  monitor?: RunMonitor | null;
  toolRegistry?: ToolRegistry;
  workspaceRoot?: string;
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
  if (persistence?.migrate) await persistence.migrate();
  await app.register(cors, { origin: true });
  await registerHealthRoute(app);
  await registerWorkflowRoutes(app, { persistence, monitor, toolRegistry, workspaceRoot });
  await registerRunRoutes(app, { persistence, monitor });
  if (persistence?.close) app.addHook('onClose', async () => persistence.close?.());
  return app;
}
