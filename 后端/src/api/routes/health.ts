import type { HealthResponse } from '@ai-workflow/shared-types';
import type { FastifyInstance } from 'fastify';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'backend',
    timestamp: new Date().toISOString(),
  }));
}
