import { describe, expect, it, vi } from 'vitest';
import { createWorkflowDefinition } from '@ai-workflow/shared-types';
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
