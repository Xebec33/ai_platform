import type { JsonObject, JsonValue, WorkflowDefinition } from '@ai-workflow/shared-types';
import type {
  AgentExecutionContext,
  AgentExecutor,
  AgentExecutorLike,
  AgentOutput,
} from '../../agents/agent.js';

export type RunStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
export type NodeRunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export type {
  AgentExecutionContext,
  AgentExecutor,
  AgentExecutorLike,
  AgentOutput as AgentExecutionOutput,
};

export interface WorkflowRunOptions {
  variables?: JsonObject;
  signal?: AbortSignal;
}

export interface WorkflowNodeRun {
  id: string;
  nodeId: string;
  status: NodeRunStatus;
  input?: JsonValue;
  output?: JsonObject;
  attempts: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  errorCode?: string;
  iteration?: number;
}

export interface WorkflowCheckpoint {
  id: string;
  runId: string;
  workflowId: string;
  currentNode: string;
  variables: JsonObject;
  nodeOutputs: Readonly<Record<string, JsonObject>>;
  iterations: Readonly<Record<string, number>>;
  createdAt: string;
}

export interface CheckpointStore {
  save(checkpoint: WorkflowCheckpoint): void | Promise<void>;
}

export interface WorkflowPersistenceState {
  runId: string;
  workflowId: string;
  currentNode?: string;
  iteration?: number;
  variables: JsonObject;
  nodeOutputs: Readonly<Record<string, JsonObject>>;
}

export interface WorkflowPersistence {
  migrate?(): void | Promise<void>;
  close?(): void | Promise<void>;
  saveWorkflow(workflow: WorkflowDefinition): void | Promise<void>;
  saveRun(
    run: WorkflowRunResult,
    currentNode?: string,
    nodeOutputs?: Readonly<Record<string, JsonObject>>,
  ): void | Promise<void>;
  saveNodeRun(runId: string, nodeRun: WorkflowNodeRun): void | Promise<void>;
  saveState(state: WorkflowPersistenceState): void | Promise<void>;
  listRuns?(limit?: number): Promise<WorkflowRunResult[]>;
  saveCheckpoint(checkpoint: WorkflowCheckpoint): void | Promise<void>;
  getWorkflow?(workflowId: string): Promise<WorkflowDefinition | undefined>;
  getRun?(runId: string): Promise<WorkflowRunResult | undefined>;
}

export interface WorkflowRunResult {
  id: string;
  workflowId: string;
  status: RunStatus;
  variables: JsonObject;
  output?: JsonObject;
  nodeRuns: WorkflowNodeRun[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
  errorCode?: string;
  persistenceError?: string;
  iterations: Record<string, number>;
  checkpoints: WorkflowCheckpoint[];
}

export type { RunMonitor } from '../../runs/run-monitor.js';

export interface WorkflowRuntimeOptions {
  eventSink?: import('./events.js').WorkflowEventSink;
  runMonitor?: import('../../runs/run-monitor.js').RunMonitor;
  agentExecutor?: AgentExecutorLike;
  agentTimeoutMs?: number;
  maxAgentRetries?: number;
  runIdFactory?: () => string;
  nodeRunIdFactory?: (nodeId: string, index: number) => string;
  workflowTimeoutMs?: number;
  checkpointStore?: CheckpointStore;
  persistence?: WorkflowPersistence;
}

export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    readonly issues: ReadonlyArray<{ code: string; message: string; path: string }>,
  ) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

export class WorkflowRuntimeError extends Error {
  constructor(
    message: string,
    readonly code = 'RUNTIME_ERROR',
  ) {
    super(message);
    this.name = 'WorkflowRuntimeError';
  }
}

export type RuntimeWorkflow = WorkflowDefinition;
