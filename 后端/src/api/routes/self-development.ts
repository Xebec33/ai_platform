import type { FastifyInstance } from 'fastify';
import type { SelfDevelopmentOrchestrator } from '../../self-development/index.js';
import type { DevelopmentSessionManager } from '../../self-development/index.js';
import { createSelfDevelopmentWorkflow, type SelfDevelopmentWorkflowOptions } from '../../self-development/index.js';
import { compactRunResult } from '../../self-development/compact.js';

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
      return reply.code(result.run.status === 'SUCCESS' ? 200 : 422).send(compactRunResult(result));
    } catch (error) {
      request.log.error(error);
      const code =
        typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : 'SELF_DEVELOPMENT_FAILED';
      return reply.code(422).send({
        error: error instanceof Error ? error.message : 'Self-development 执行失败',
        code,
      });
    }
  });

  app.get('/self-development/sessions', async (_request, reply) => {
    const sessions = options.sessions;
    if (!sessions) return reply.code(503).send({ error: 'Self-development 未配置' });
    return reply.send(
      sessions.list().map((session) => ({
        ...session,
        phase: sessions.activePhase(session.id),
      })),
    );
  });

  app.get<{ Params: { taskId: string } }>(
    '/self-development/sessions/:taskId/progress',
    async (request, reply) => {
      if (!options.sessions) return reply.code(503).send({ error: 'Self-development 未配置' });
      const progress = options.sessions.getProgress(request.params.taskId);
      if (!progress) return reply.code(404).send({ error: '暂无进度记录' });
      return reply.send(progress);
    },
  );

  app.get<{ Params: { taskId: string } }>(
    '/self-development/sessions/:taskId',
    async (request, reply) => {
      if (!options.sessions) return reply.code(503).send({ error: 'Self-development 未配置' });
      const session = options.sessions.get(request.params.taskId);
      if (!session) return reply.code(404).send({ error: '开发会话不存在' });
      try {
        const diff = await options.sessions.diff(session.id);
        const result = options.sessions.getResult(session.id);
        return reply.send({
          workspace: session,
          diff,
          result: result ? compactRunResult(result) : null,
        });
      } catch (error) {
        return reply.code(422).send({
          error: '获取会话 Diff 失败',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
}
