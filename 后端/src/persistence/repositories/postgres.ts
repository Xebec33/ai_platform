import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { JsonObject, WorkflowDefinition } from '@ai-workflow/shared-types';
import type {
  WorkflowCheckpoint,
  WorkflowNodeRun,
  WorkflowPersistence,
  WorkflowPersistenceState,
  WorkflowRunResult,
} from '../../workflow/runtime/types.js';
import { persistenceSchema } from '../models/schema.js';

export interface PersistedWorkflowRun {
  result: WorkflowRunResult;
  currentNode?: string;
  nodeOutputs?: Record<string, JsonObject>;
}

export class PostgresPersistence implements WorkflowPersistence {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(persistenceSchema);
  }

  async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    await this.pool.query(
      `INSERT INTO workflows (id, name, version, definition)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         version = EXCLUDED.version,
         definition = EXCLUDED.definition,
         updated_at = NOW()`,
      [workflow.id, workflow.name, workflow.version, JSON.stringify(workflow)],
    );
  }

  async saveRun(
    run: WorkflowRunResult,
    currentNode?: string,
    nodeOutputs: Readonly<Record<string, JsonObject>> = {},
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      await upsertRun(client, run, currentNode, nodeOutputs);
    });
  }

  async saveNodeRun(runId: string, nodeRun: WorkflowNodeRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO node_runs
         (id, run_id, node_id, status, input, output, attempts, iteration, error, error_code, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         input = EXCLUDED.input,
         output = EXCLUDED.output,
         attempts = EXCLUDED.attempts,
         iteration = EXCLUDED.iteration,
         error = EXCLUDED.error,
         error_code = EXCLUDED.error_code,
         finished_at = EXCLUDED.finished_at`,
      [
        nodeRun.id,
        runId,
        nodeRun.nodeId,
        nodeRun.status,
        nullableJson(nodeRun.input),
        nullableJson(nodeRun.output),
        nodeRun.attempts,
        nodeRun.iteration ?? null,
        nodeRun.error ?? null,
        nodeRun.errorCode ?? null,
        nodeRun.startedAt,
        nodeRun.finishedAt ?? null,
      ],
    );
  }

  async saveState(state: WorkflowPersistenceState): Promise<void> {
    await upsertState(this.pool, state);
  }

  async saveCheckpoint(checkpoint: WorkflowCheckpoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO checkpoints
         (id, run_id, workflow_id, current_node, variables, node_outputs, iterations, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        checkpoint.id,
        checkpoint.runId,
        checkpoint.workflowId,
        checkpoint.currentNode,
        JSON.stringify(checkpoint.variables),
        JSON.stringify(checkpoint.nodeOutputs),
        JSON.stringify(checkpoint.iterations),
        checkpoint.createdAt,
      ],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getWorkflow(workflowId: string): Promise<WorkflowDefinition | undefined> {
    const result = await this.pool.query<{ definition: WorkflowDefinition }>(
      'SELECT definition FROM workflows WHERE id = $1',
      [workflowId],
    );
    return result.rows[0]?.definition;
  }

  async listRuns(limit = 50): Promise<WorkflowRunResult[]> {
    const result = await this.pool.query<{ id: string }>(
      'SELECT id FROM workflow_runs ORDER BY started_at DESC LIMIT $1',
      [Math.max(1, Math.min(limit, 200))],
    );
    const runs = await Promise.all(result.rows.map((row) => this.getRun(row.id)));
    return runs.filter((run): run is WorkflowRunResult => Boolean(run));
  }

  async getRun(runId: string): Promise<WorkflowRunResult | undefined> {
    const runResult = await this.pool.query<RunRow>(
      `SELECT id, workflow_id, status, current_node, iteration, iterations, variables, node_outputs,
              output, error, error_code, started_at, finished_at
       FROM workflow_runs WHERE id = $1`,
      [runId],
    );
    const row = runResult.rows[0];
    if (!row) return undefined;
    const [nodeResult, checkpointResult] = await Promise.all([
      this.pool.query<NodeRow>(
        `SELECT id, node_id, status, input, output, attempts, iteration, error, error_code,
                started_at, finished_at
         FROM node_runs WHERE run_id = $1 ORDER BY started_at, id`,
        [runId],
      ),
      this.pool.query<CheckpointRow>(
        `SELECT id, run_id, workflow_id, current_node, variables, node_outputs, iterations, created_at
         FROM checkpoints WHERE run_id = $1 ORDER BY created_at, id`,
        [runId],
      ),
    ]);
    const result: WorkflowRunResult = {
      id: row.id,
      workflowId: row.workflow_id,
      status: row.status as WorkflowRunResult['status'],
      variables: row.variables,
      output: row.output ?? undefined,
      nodeRuns: nodeResult.rows.map(toNodeRun),
      startedAt: row.started_at.toISOString(),
      finishedAt: row.finished_at?.toISOString(),
      error: row.error ?? undefined,
      errorCode: row.error_code ?? undefined,
      iterations: row.iterations,
      checkpoints: checkpointResult.rows.map(toCheckpoint),
    };
    return result;
  }

  private async withTransaction(work: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function upsertRun(
  client: Pick<Pool, 'query'>,
  run: WorkflowRunResult,
  currentNode: string | undefined,
  nodeOutputs: Readonly<Record<string, JsonObject>>,
): Promise<void> {
  await client.query(
    `INSERT INTO workflow_runs
       (id, workflow_id, status, current_node, iteration, iterations, variables, node_outputs, output, error, error_code, started_at, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, $13)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       current_node = EXCLUDED.current_node,
       iteration = EXCLUDED.iteration,
       iterations = EXCLUDED.iterations,
       variables = EXCLUDED.variables,
       node_outputs = EXCLUDED.node_outputs,
       output = EXCLUDED.output,
       error = EXCLUDED.error,
       error_code = EXCLUDED.error_code,
       finished_at = EXCLUDED.finished_at,
       updated_at = NOW()`,
    [
      run.id,
      run.workflowId,
      run.status,
      currentNode ?? null,
      currentIteration(run),
      JSON.stringify(run.iterations),
      JSON.stringify(run.variables),
      JSON.stringify(nodeOutputs),
      nullableJson(run.output),
      run.error ?? null,
      run.errorCode ?? null,
      run.startedAt,
      run.finishedAt ?? null,
    ],
  );
}

async function upsertState(
  client: Pick<Pool, 'query'>,
  state: WorkflowPersistenceState,
): Promise<void> {
  await client.query(
    `INSERT INTO workflow_states (run_id, current_node, iteration, variables, node_outputs)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     ON CONFLICT (run_id) DO UPDATE SET
       current_node = EXCLUDED.current_node,
       iteration = EXCLUDED.iteration,
       variables = EXCLUDED.variables,
       node_outputs = EXCLUDED.node_outputs,
       updated_at = NOW()`,
    [
      state.runId,
      state.currentNode ?? null,
      state.iteration ?? null,
      JSON.stringify(state.variables),
      JSON.stringify(state.nodeOutputs),
    ],
  );
}

interface RunRow extends QueryResultRow {
  id: string;
  workflow_id: string;
  status: string;
  current_node: string | null;
  iteration: number | null;
  iterations: Record<string, number>;
  variables: JsonObject;
  node_outputs: Record<string, JsonObject>;
  output: JsonObject | null;
  error: string | null;
  error_code: string | null;
  started_at: Date;
  finished_at: Date | null;
}
interface NodeRow extends QueryResultRow {
  id: string;
  node_id: string;
  status: WorkflowNodeRun['status'];
  input: unknown;
  output: JsonObject | null;
  attempts: number;
  iteration: number | null;
  error: string | null;
  error_code: string | null;
  started_at: Date;
  finished_at: Date | null;
}
interface CheckpointRow extends QueryResultRow {
  id: string;
  run_id: string;
  workflow_id: string;
  current_node: string;
  variables: JsonObject;
  node_outputs: Record<string, JsonObject>;
  iterations: Record<string, number>;
  created_at: Date;
}

function currentIteration(run: WorkflowRunResult): number | null {
  const values = Object.values(run.iterations);
  return values.length > 0 ? Math.max(...values) : null;
}
function nullableJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}
function toNodeRun(row: NodeRow): WorkflowNodeRun {
  return {
    id: row.id,
    nodeId: row.node_id,
    status: row.status,
    input: row.input as WorkflowNodeRun['input'],
    output: row.output ?? undefined,
    attempts: row.attempts,
    iteration: row.iteration ?? undefined,
    error: row.error ?? undefined,
    errorCode: row.error_code ?? undefined,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString(),
  };
}
function toCheckpoint(row: CheckpointRow): WorkflowCheckpoint {
  return {
    id: row.id,
    runId: row.run_id,
    workflowId: row.workflow_id,
    currentNode: row.current_node,
    variables: row.variables,
    nodeOutputs: row.node_outputs,
    iterations: row.iterations,
    createdAt: row.created_at.toISOString(),
  };
}
