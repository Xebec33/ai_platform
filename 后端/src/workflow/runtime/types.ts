import type {
  AgentNode,
  JsonObject,
  JsonValue,
  WorkflowDefinition,
} from '@ai-workflow/shared-types';

export type RunStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
export type NodeRunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface AgentExecutionContext {
  node: AgentNode;
  input: JsonValue;
  variables: JsonObject;
  nodeOutputs: Readonly<Record<string, JsonObject>>;
  signal?: AbortSignal;
}

export interface AgentExecutionOutput {
  output: JsonObject;
}

export interface AgentExecutor {
  execute(context: AgentExecutionContext): Promise<AgentExecutionOutput>;
}

export type AgentExecutorLike =
  AgentExecutor | ((context: AgentExecutionContext) => Promise<AgentExecutionOutput>);

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
