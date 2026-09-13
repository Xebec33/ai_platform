import type { JsonObject, WorkflowDefinition } from '@ai-workflow/shared-types';
import type { FastifyInstance } from 'fastify';
import {
  createWorkflowRuntime,
  WorkflowValidationError,
  type WorkflowPersistence,
  type WorkflowRuntimeOptions,
} from '../../workflow/runtime/index.js';

interface RunBody {
  workflow?: WorkflowDefinition;
  variables?: JsonObject;
}

interface WorkflowBody {
  workflow?: WorkflowDefinition;
}

export async function registerWorkflowRoutes(
  app: FastifyInstance,
  options: { persistence?: WorkflowPersistence } = {},
): Promise<void> {
  app.post<{ Body: WorkflowBody }>('/workflows', async (request, reply) => {
    if (!request.body?.workflow) return reply.code(400).send({ error: 'workflow 不能为空' });
    if (!options.persistence?.saveWorkflow) return reply.code(503).send({ error: '持久化未配置' });
    await options.persistence.saveWorkflow(request.body.workflow);
    return reply.code(201).send({ workflowId: request.body.workflow.id });
  });

  app.get<{ Params: { workflowId: string } }>('/workflows/:workflowId', async (request, reply) => {
    const workflow = await options.persistence?.getWorkflow?.(request.params.workflowId);
    if (!workflow) return reply.code(404).send({ error: 'Workflow 不存在' });
    return reply.send(workflow);
  });

  app.get<{ Params: { runId: string } }>('/runs/:runId', async (request, reply) => {
    const run = await options.persistence?.getRun?.(request.params.runId);
    if (!run) return reply.code(404).send({ error: 'Run 不存在' });
    return reply.send(run);
  });

  app.post<{ Body: RunBody }>('/workflows/run', async (request, reply) => {
    if (!request.body?.workflow) return reply.code(400).send({ error: 'workflow 不能为空' });
    try {
      const runtimeOptions: WorkflowRuntimeOptions = {
        maxAgentRetries: 0,
        persistence: options.persistence,
      };
      const result = await createWorkflowRuntime(request.body.workflow, runtimeOptions).execute({
        variables: request.body.variables,
      });
      return reply.code(result.status === 'SUCCESS' ? 200 : 422).send(result);
    } catch (error) {
      if (error instanceof WorkflowValidationError)
        return reply.code(400).send({ error: error.message, issues: error.issues });
      throw error;
    }
  });
}
