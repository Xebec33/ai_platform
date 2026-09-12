import { registerWorkflowRoutes } from './api/routes/workflows.js';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoute } from './api/routes/health.js';

export interface AppOptions {
  logger?: boolean;
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cors, { origin: true });
  await registerHealthRoute(app);
  await registerWorkflowRoutes(app);
  return app;
}
