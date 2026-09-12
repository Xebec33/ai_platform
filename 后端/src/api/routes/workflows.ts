import type { WorkflowDefinition, JsonObject } from '@ai-workflow/shared-types';
import type { FastifyInstance } from 'fastify';
import {
  createWorkflowRuntime,
  WorkflowValidationError,
  type WorkflowRuntimeOptions,
} from '../../workflow/runtime/index.js';

interface RunBody {
  workflow?: WorkflowDefinition;
  variables?: JsonObject;
}

export async function registerWorkflowRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RunBody }>('/workflows/run', async (request, reply) => {
    if (!request.body?.workflow) return reply.code(400).send({ error: 'workflow 不能为空' });
    try {
      const runtimeOptions: WorkflowRuntimeOptions = { maxAgentRetries: 0 };
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
