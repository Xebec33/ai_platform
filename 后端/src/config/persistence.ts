import { Pool, type PoolConfig } from 'pg';
import { PostgresPersistence } from '../persistence/index.js';
import { PostgresJobQueue } from '../queue/jobs/postgres.js';
import type { WorkflowWorkerOptions } from '../queue/worker.js';

const DEFAULT_POOL_MAX = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

export function createPostgresPersistenceFromEnv(): PostgresPersistence | undefined {
  const config = createPostgresPoolConfigFromEnv();
  if (!config) {
    if (process.env.NODE_ENV === 'production') throw new Error('生产环境必须配置 DATABASE_URL');
    return undefined;
  }
  return new PostgresPersistence(new Pool(config));
}

export function createPostgresJobQueueFromEnv(): PostgresJobQueue | undefined {
  const config = createPostgresPoolConfigFromEnv();
  if (!config) return undefined;
  return new PostgresJobQueue(new Pool(config));
}

export function createWorkflowWorkerOptionsFromEnv(): WorkflowWorkerOptions {
  return {
    workerId: process.env.WORKER_ID?.trim() || undefined,
    concurrency: readInteger('WORKER_CONCURRENCY', 1, 1),
    leaseMs: readInteger('QUEUE_LEASE_MS', 30_000, 1),
    pollIntervalMs: readInteger('QUEUE_POLL_INTERVAL_MS', 250, 1),
    retryDelayMs: readInteger('QUEUE_RETRY_DELAY_MS', 1_000, 0),
    maxJobAttempts: readInteger('QUEUE_MAX_ATTEMPTS', 3, 1),
    maxAgentRetries: readInteger('WORKER_AGENT_MAX_RETRIES', 0, 0),
    agentTimeoutMs: readOptionalInteger('WORKER_AGENT_TIMEOUT_MS'),
    workflowTimeoutMs: readOptionalInteger('WORKFLOW_TIMEOUT_MS'),
  };
}

export function createPostgresPoolConfigFromEnv(): PoolConfig | undefined {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return undefined;

  const sslEnabled = readBoolean('DATABASE_SSL', process.env.NODE_ENV === 'production');
  const config: PoolConfig = {
    connectionString,
    max: readInteger('DATABASE_POOL_MAX', DEFAULT_POOL_MAX, 1),
    idleTimeoutMillis: readInteger('DATABASE_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS, 0),
    connectionTimeoutMillis: readInteger(
      'DATABASE_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
      0,
    ),
    statement_timeout: readInteger(
      'DATABASE_STATEMENT_TIMEOUT_MS',
      DEFAULT_STATEMENT_TIMEOUT_MS,
      0,
    ),
    application_name: process.env.DATABASE_APPLICATION_NAME?.trim() || 'ai-workflow-platform',
  };

  if (sslEnabled) {
    const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, '\n').trim();
    config.ssl = {
      rejectUnauthorized: readBoolean('DATABASE_SSL_REJECT_UNAUTHORIZED', true),
      ...(ca ? { ca } : {}),
    };
  }

  return config;
}

function readBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`${name} 必须是 true/false`);
}

function readOptionalInteger(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  return readInteger(name, 0, 1);
}

function readInteger(name: string, defaultValue: number, minimum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum)
    throw new Error(`${name} 必须是大于等于 ${minimum} 的整数`);
  return value;
}
