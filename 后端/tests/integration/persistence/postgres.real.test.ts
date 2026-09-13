import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkflowDefinition } from '@ai-workflow/shared-types';
import { PostgresPersistence } from '../../../src/persistence/index.js';
import type { WorkflowRunResult } from '../../../src/workflow/runtime/types.js';

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const resources: Array<{
  pool: Pool;
  persistence: PostgresPersistence;
  workflowId: string;
  runId: string;
}> = [];

describeDatabase('PostgreSQL persistence', () => {
  afterEach(async () => {
    const resource = resources.pop();
    if (!resource) return;
    await resource.pool.query('DELETE FROM workflow_runs WHERE id = $1', [resource.runId]);
    await resource.pool.query('DELETE FROM workflows WHERE id = $1', [resource.workflowId]);
    await resource.persistence.close();
  });

  it('migrates and round-trips Workflow, Run, NodeRun, State and Checkpoint', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const persistence = new PostgresPersistence(pool);
    const workflowId = 'integration-' + randomUUID();
    const runId = 'run-' + randomUUID();
    resources.push({ pool, persistence, workflowId, runId });
    const workflow = createWorkflowDefinition(workflowId, 'Postgres integration');
    const now = new Date().toISOString();
    const run: WorkflowRunResult = {
      id: runId,
      workflowId,
      status: 'SUCCESS',
      variables: { query: 'hello' },
      output: { answer: 'world' },
      nodeRuns: [],
      startedAt: now,
      finishedAt: now,
      iterations: { 'loop-1': 2 },
      checkpoints: [],
    };

    await persistence.migrate();
    await persistence.saveWorkflow(workflow);
    await persistence.saveRun(run, 'end-1', { 'agent-1': { answer: 'world' } });
    await persistence.saveState({
      runId,
      workflowId,
      currentNode: 'end-1',
      iteration: 2,
      variables: run.variables,
      nodeOutputs: { 'agent-1': { answer: 'world' } },
    });
    await persistence.saveNodeRun(runId, {
      id: 'node-run-' + randomUUID(),
      nodeId: 'agent-1',
      status: 'SUCCESS',
      input: { query: 'hello' },
      output: { answer: 'world' },
      attempts: 1,
      startedAt: now,
      finishedAt: now,
    });
    await persistence.saveCheckpoint({
      id: 'checkpoint-' + randomUUID(),
      runId,
      workflowId,
      currentNode: 'end-1',
      variables: run.variables,
      nodeOutputs: { 'agent-1': { answer: 'world' } },
      iterations: { 'loop-1': 2 },
      createdAt: now,
    });

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN
       ('workflows', 'workflow_runs', 'node_runs', 'workflow_states', 'checkpoints')`,
    );
    const restoredWorkflow = await persistence.getWorkflow(workflowId);
    const restoredRun = await persistence.getRun(runId);
    const restoredState = await pool.query<{ current_node: string; iteration: number }>(
      'SELECT current_node, iteration FROM workflow_states WHERE run_id = $1',
      [runId],
    );

    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      'checkpoints',
      'node_runs',
      'workflow_runs',
      'workflow_states',
      'workflows',
    ]);
    expect(restoredWorkflow).toMatchObject({ id: workflowId, name: 'Postgres integration' });
    expect(restoredRun).toMatchObject({
      id: runId,
      status: 'SUCCESS',
      output: { answer: 'world' },
    });
    expect(restoredRun?.nodeRuns).toHaveLength(1);
    expect(restoredRun?.checkpoints).toHaveLength(1);
    expect(restoredState.rows[0]).toMatchObject({ current_node: 'end-1', iteration: 2 });
  });
});
