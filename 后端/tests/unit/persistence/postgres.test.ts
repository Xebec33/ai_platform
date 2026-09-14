import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowDefinition } from '@ai-workflow/shared-types';
import {
  createPostgresPersistenceFromEnv,
  createPostgresPoolConfigFromEnv,
} from '../../../src/config/persistence.js';
import { PostgresPersistence } from '../../../src/persistence/index.js';

function fakePool() {
  const query = vi.fn(async () => ({ rows: [] }));
  const client = {
    query,
    release: vi.fn(),
  };
  return { pool: { query, connect: vi.fn(async () => client) }, query, client };
}

describe('PostgresPersistence', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a production-ready pool config from environment variables', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://db-user:secret@db.example.com:5432/workflows');
    vi.stubEnv('DATABASE_SSL', 'true');
    vi.stubEnv('DATABASE_SSL_REJECT_UNAUTHORIZED', 'true');
    vi.stubEnv('DATABASE_SSL_CA', 'line-1\\nline-2');
    vi.stubEnv('DATABASE_POOL_MAX', '20');
    vi.stubEnv('DATABASE_IDLE_TIMEOUT_MS', '45000');
    vi.stubEnv('DATABASE_CONNECTION_TIMEOUT_MS', '12000');
    vi.stubEnv('DATABASE_STATEMENT_TIMEOUT_MS', '60000');
    vi.stubEnv('DATABASE_APPLICATION_NAME', 'workflow-api');

    expect(createPostgresPoolConfigFromEnv()).toEqual({
      connectionString: 'postgresql://db-user:secret@db.example.com:5432/workflows',
      max: 20,
      idleTimeoutMillis: 45000,
      connectionTimeoutMillis: 12000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      maxLifetimeSeconds: 300,
      statement_timeout: 60000,
      application_name: 'workflow-api',
      ssl: {
        rejectUnauthorized: true,
        ca: 'line-1\nline-2',
      },
    });
  });

  it('does not require a database in non-production environments', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', '');
    expect(createPostgresPoolConfigFromEnv()).toBeUndefined();
    expect(createPostgresPersistenceFromEnv()).toBeUndefined();
  });

  it('fails fast when production has no database URL', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', '');
    expect(() => createPostgresPersistenceFromEnv()).toThrow('生产环境必须配置 DATABASE_URL');
  });

  it('creates the Phase 6 schema through migration', async () => {
    const { pool, query } = fakePool();
    await new PostgresPersistence(pool).migrate();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS workflows'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS checkpoints'),
    );
  });

  it('persists a run and state in one transaction', async () => {
    const { pool, query, client } = fakePool();
    const persistence = new PostgresPersistence(pool);
    const run = {
      id: 'run-1',
      workflowId: 'workflow-1',
      status: 'RUNNING' as const,
      variables: { query: 'hello' },
      nodeRuns: [],
      startedAt: new Date().toISOString(),
      iterations: {},
      checkpoints: [],
    };

    await persistence.saveRun(run, 'agent-1', { 'agent-1': { answer: 'ok' } });

    expect(pool.connect).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('workflow_runs'),
      expect.arrayContaining([JSON.stringify({ 'agent-1': { answer: 'ok' } })]),
    );
    expect(query).not.toHaveBeenCalledWith('ROLLBACK');
  });

  it('upserts workflow definitions', async () => {
    const { pool, query } = fakePool();
    await new PostgresPersistence(pool).saveWorkflow(createWorkflowDefinition('wf-1', 'Persisted'));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflows'),
      expect.arrayContaining(['wf-1', 'Persisted', 1]),
    );
  });
});
