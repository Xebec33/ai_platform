import { createPostgresJobQueueFromEnv, createPostgresPersistenceFromEnv, createWorkflowWorkerOptionsFromEnv } from './config/persistence.js';
import { createDefaultToolRegistry } from './tools/index.js';
import { WorkflowWorker } from './queue/worker.js';

const persistence = createPostgresPersistenceFromEnv();
const queue = createPostgresJobQueueFromEnv();
if (!persistence || !queue) throw new Error('Worker 必须配置 DATABASE_URL');
const workspaceRoot = process.env.WORKSPACE_ROOT?.trim() || process.cwd();
const worker = new WorkflowWorker(queue, persistence, undefined, {
  ...createWorkflowWorkerOptionsFromEnv(),
  workspaceRoot,
  toolRegistry: createDefaultToolRegistry(workspaceRoot),
});

await persistence.migrate?.();
await queue.migrate?.();
await worker.start();

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await worker.stop();
  await persistence.close?.();
  await queue.close?.();
};

process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
