import type { FastifyInstance } from 'fastify';
import type { SelfDevelopmentOrchestrator } from '../../self-development/index.js';
import type { DevelopmentSessionManager } from '../../self-development/index.js';
import { createSelfDevelopmentWorkflow, type SelfDevelopmentWorkflowOptions } from '../../self-development/index.js';

export async function registerSelfDevelopmentRoutes(
  app: FastifyInstance,
  options: {
    orchestrator?: SelfDevelopmentOrchestrator;
    sessions?: DevelopmentSessionManager;
  } = {},
): Promise<void> {
  app.get('/self-development/workflow', async (request, reply) => {
    const query = request.query as { taskId?: string; requirement?: string; model?: string };
    return reply.send(
      createSelfDevelopmentWorkflow({
        taskId: query.taskId,
        requirement: query.requirement,
        model: query.model,
      }),
    );
  });

  app.post<{ Body: SelfDevelopmentWorkflowOptions }>('/self-development/run', async (request, reply) => {
    if (!options.orchestrator) return reply.code(503).send({ error: 'Self-development 未配置' });
    try {
      const result = await options.orchestrator.execute(request.body ?? {});
      return reply.code(result.run.status === 'SUCCESS' ? 200 : 422).send(result);
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({
        error: 'Self-development 执行失败',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/self-development/sessions', async (_request, reply) => {
    if (!options.sessions) return reply.code(503).send({ error: 'Self-development 未配置' });
    return reply.send(options.sessions.list());
  });

  app.get<{ Params: { taskId: string } }>(
    '/self-development/sessions/:taskId',
    async (request, reply) => {
      if (!options.sessions) return reply.code(503).send({ error: 'Self-development 未配置' });
      const session = options.sessions.get(request.params.taskId);
      if (!session) return reply.code(404).send({ error: '开发会话不存在' });
      try {
        const diff = await options.sessions.diff(session.id);
        return reply.send({ workspace: session, diff });
      } catch (error) {
        return reply.code(422).send({
          error: '获取会话 Diff 失败',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
}
