import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import path from 'node:path';
import { registerHealthRoute } from './api/routes/health.js';
import { registerWorkflowRoutes } from './api/routes/workflows.js';
import { registerRunRoutes } from './api/routes/runs.js';
import { registerSelfDevelopmentRoutes } from './api/routes/self-development.js';
import { registerWorkspaceRoutes } from './api/routes/workspace.js';
import { createInviteCodeGuard, registerAuthRoutes } from './api/routes/auth.js';
import {
  createPostgresJobQueueFromEnv,
  createPostgresPersistenceFromEnv,
  createWorkflowWorkerOptionsFromEnv,
  isDatabaseConnectivityError,
} from './config/persistence.js';
import { InMemoryRunMonitor, type RunMonitor } from './runs/run-monitor.js';
import type { WorkflowPersistence } from './workflow/runtime/types.js';
import { createDefaultToolRegistry, type ToolRegistry } from './tools/index.js';
import { createDefaultAgentExecutor, type AgentExecutorLike } from './agents/index.js';
import { WorkflowWorker, type WorkflowWorkerOptions } from './queue/worker.js';
import type { JobQueue } from './queue/jobs/types.js';
import { AgentRegistry } from './agents/index.js';
import {
  CodingAgentExecutor,
  DockerCodingAgentAdapter,
  OpenCodeAdapter,
} from './coding-agent/index.js';
import { DockerSandboxExecutor } from './sandbox/index.js';
import {
  DevelopmentSessionManager,
  DevelopmentWorkspaceManager,
  SelfDevelopmentOrchestrator,
} from './self-development/index.js';

export interface AppOptions {
  logger?: boolean;
  persistence?: WorkflowPersistence;
  monitor?: RunMonitor | null;
  toolRegistry?: ToolRegistry;
  agentExecutor?: AgentExecutorLike;
  workspaceRoot?: string;
  queue?: JobQueue;
  asyncRuns?: boolean;
  worker?: boolean;
  workerOptions?: WorkflowWorkerOptions;
  inviteCode?: string;
  selfDevelopment?: {
    enabled?: boolean;
    repositoryRoot?: string;
    workspacesRoot?: string;
    sandbox?: DockerSandboxExecutor;
  };
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    requestTimeout: readPositiveInteger('HTTP_REQUEST_TIMEOUT_MS', 15 * 60_000),
    keepAliveTimeout: readPositiveInteger('HTTP_KEEP_ALIVE_TIMEOUT_MS', 75_000),
    connectionTimeout: readPositiveInteger('HTTP_CONNECTION_TIMEOUT_MS', 0),
  });
  const persistence =
    options.persistence ??
    (process.env.NODE_ENV === 'test' ? undefined : createPostgresPersistenceFromEnv());
  const monitor =
    options.monitor === undefined ? new InMemoryRunMonitor() : (options.monitor ?? undefined);
  const workspaceRoot =
    options.workspaceRoot ??
    (process.env.WORKSPACE_ROOT?.trim()
      ? path.resolve(process.env.WORKSPACE_ROOT.trim())
      : process.cwd());
  const inviteCode =
    options.inviteCode ??
    (process.env.NODE_ENV === 'test' ? undefined : process.env.INVITE_CODE?.trim() || undefined);
  const selfDevelopmentEnabled =
    options.selfDevelopment?.enabled ??
    (process.env.NODE_ENV !== 'test' && process.env.SELF_DEVELOPMENT_ENABLED === 'true');
  const sandbox = options.selfDevelopment?.sandbox ?? new DockerSandboxExecutor();
  const toolRegistry =
    options.toolRegistry ??
    createDefaultToolRegistry(workspaceRoot, selfDevelopmentEnabled ? sandbox : undefined);
  const agentExecutor = options.agentExecutor ?? createDefaultAgentExecutor();
  const queue =
    options.queue ??
    (process.env.NODE_ENV === 'test' ? undefined : createPostgresJobQueueFromEnv());
  const workerOptions =
    options.workerOptions ??
    (process.env.NODE_ENV === 'test' ? undefined : createWorkflowWorkerOptionsFromEnv());
  const workerEnabled = options.worker ?? process.env.WORKER_ENABLED !== 'false';
  const worker =
    queue && persistence && workerEnabled
      ? new WorkflowWorker(queue, persistence, monitor, {
          ...workerOptions,
          toolRegistry,
          workspaceRoot,
          onError: (error) => app.log.error({ err: error }, 'Workflow worker error'),
        })
      : undefined;

  if (persistence?.migrate) await persistence.migrate();
  if (queue?.migrate) await queue.migrate();
  await app.register(cors, { origin: true });
  await app.addHook('preHandler', createInviteCodeGuard(inviteCode));
  await registerAuthRoutes(app, { inviteCode });
  await registerWorkspaceRoutes(app, { workspaceRoot });
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    if (isDatabaseConnectivityError(error)) {
      return reply.code(503).send({
        error: '数据库暂时不可用，请稍后重试',
        code: 'DATABASE_UNAVAILABLE',
      });
    }
    return reply.code(500).send({
      error: '后端内部错误',
      details: error instanceof Error ? error.message : String(error),
    });
  });
  await registerHealthRoute(app);
  await registerWorkflowRoutes(app, {
    persistence,
    monitor,
    toolRegistry,
    agentExecutor,
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
    sseHeartbeatMs: readPositiveInteger('SSE_HEARTBEAT_MS', 15_000),
  });
  if (selfDevelopmentEnabled) {
    const repositoryRoot = options.selfDevelopment?.repositoryRoot ?? workspaceRoot;
    const workspaceManager = new DevelopmentWorkspaceManager({
      repositoryRoot,
      workspacesRoot:
        options.selfDevelopment?.workspacesRoot ??
        (process.env.SELF_DEVELOPMENT_WORKSPACES_ROOT?.trim() || undefined),
    });
    const sessions = new DevelopmentSessionManager({ workspaceManager, sandboxExecutor: sandbox });
    const codingAdapter =
      process.env.CODING_AGENT_IN_SANDBOX === 'true'
        ? new DockerCodingAgentAdapter({
            executor: sandbox,
            defaultModel: process.env.OPENAI_MODEL,
            environment: codingAgentEnvironment(),
          })
        : new OpenCodeAdapter({ defaultModel: process.env.OPENAI_MODEL });
    const agentRegistry = new AgentRegistry([
      ['coding-agent', new CodingAgentExecutor({ adapter: codingAdapter })],
    ]);
    const selfDevModel = process.env.OPENAI_MODEL?.trim() || undefined;
    await registerSelfDevelopmentRoutes(app, {
      orchestrator: new SelfDevelopmentOrchestrator({
        sessions,
        workspaceManager,
        toolRegistry,
        agentRegistry,
        model: selfDevModel,
        codingModel: process.env.CODING_AGENT_MODEL?.trim() || selfDevModel,
        runtime: {
          agentExecutor: createDefaultAgentExecutor({
            maxToolRounds: readPositiveInteger('SELF_DEVELOPMENT_MAX_TOOL_ROUNDS', 16),
          }),
        },
      }),
      sessions,
    });
  } else {
    await registerSelfDevelopmentRoutes(app);
  }
  if (worker) await worker.start();
  app.addHook('onClose', async () => {
    await worker?.stop();
    await persistence?.close?.();
    await queue?.close?.();
  });
  return app;
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} 必须是非负整数`);
  return value;
}

function codingAgentEnvironment(): Record<string, string> {
  const result: Record<string, string> = {};
  const apiKey = process.env.OPENAI_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim();
  if (apiKey) result.OPENAI_API_KEY = apiKey;
  for (const name of ['OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_PROVIDER_ID']) {
    const value = process.env[name]?.trim();
    if (value) result[name] = value;
  }
  return result;
}
