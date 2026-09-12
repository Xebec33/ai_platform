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
}

export interface WorkflowRuntimeOptions {
  agentExecutor?: AgentExecutorLike;
  agentTimeoutMs?: number;
  maxAgentRetries?: number;
  runIdFactory?: () => string;
  nodeRunIdFactory?: (nodeId: string, index: number) => string;
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
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowRuntimeError';
  }
}

export type RuntimeWorkflow = WorkflowDefinition;
