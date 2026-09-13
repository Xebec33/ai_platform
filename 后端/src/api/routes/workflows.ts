import {
  validateWorkflow,
  type JsonObject,
  type WorkflowDefinition,
} from '@ai-workflow/shared-types';
import type { FastifyInstance } from 'fastify';
import type { ToolRegistry } from '../../tools/index.js';
import type { JobQueue } from '../../queue/jobs/types.js';
import {
  createWorkflowRuntime,
  WorkflowValidationError,
  type RunMonitor,
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
  options: {
    persistence?: WorkflowPersistence;
    monitor?: RunMonitor;
    toolRegistry?: ToolRegistry;
    workspaceRoot?: string;
    queue?: JobQueue;
    asyncRuns?: boolean;
    maxJobAttempts?: number;
    jobTimeoutMs?: number;
  } = {},
): Promise<void> {
  app.post<{ Body: WorkflowBody }>('/workflows', async (request, reply) => {
    if (!request.body?.workflow) return reply.code(400).send({ error: 'workflow 不能为空' });
    const validation = validateWorkflow(request.body.workflow);
    if (!validation.valid)
      return reply.code(400).send({ error: 'Workflow 校验失败', issues: validation.issues });
    if (!options.persistence?.saveWorkflow) return reply.code(503).send({ error: '持久化未配置' });
    try {
      await options.persistence.saveWorkflow(request.body.workflow);
      return reply.code(201).send({ workflowId: request.body.workflow.id });
    } catch (error) {
      return reply.code(503).send({
        error: 'Workflow 持久化失败',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get<{ Params: { workflowId: string } }>('/workflows/:workflowId', async (request, reply) => {
    const workflow = await options.persistence?.getWorkflow?.(request.params.workflowId);
    if (!workflow) return reply.code(404).send({ error: 'Workflow 不存在' });
    return reply.send(workflow);
  });

  app.post<{ Body: RunBody }>('/workflows/run', async (request, reply) => {
    if (!request.body?.workflow) return reply.code(400).send({ error: 'workflow 不能为空' });
    try {
      const validation = validateWorkflow(request.body.workflow);
      if (!validation.valid)
        return reply.code(400).send({ error: 'Workflow 校验失败', issues: validation.issues });
      if (options.asyncRuns && options.queue) {
        if (!options.persistence?.saveWorkflow)
          return reply.code(503).send({ error: '异步运行需要配置持久化' });
        await options.persistence.saveWorkflow(request.body.workflow);
        const runId = 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const jobId = 'job-' + runId;
        await options.persistence.saveRun({
          id: runId,
          workflowId: request.body.workflow.id,
          status: 'PENDING',
          variables: request.body.variables ?? {},
          nodeRuns: [],
          iterations: {},
          checkpoints: [],
          startedAt: new Date().toISOString(),
        });
        const job = await options.queue.enqueue({
          id: jobId,
          runId,
          workflowId: request.body.workflow.id,
          payload: {
            variables: request.body.variables ?? {},
            ...(options.jobTimeoutMs === undefined ? {} : { timeoutMs: options.jobTimeoutMs }),
          },
          maxAttempts: options.maxJobAttempts,
        });
        return reply.code(202).send({ id: runId, jobId: job.id, status: job.status });
      }
      const runtimeOptions: WorkflowRuntimeOptions = {
        maxAgentRetries: 0,
        persistence: options.persistence,
        runMonitor: options.monitor,
        toolRegistry: options.toolRegistry,
        workspaceRoot: options.workspaceRoot,
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
