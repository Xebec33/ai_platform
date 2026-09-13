import type { JsonObject } from '@ai-workflow/shared-types';

export type RunStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export type NodeRunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface NodeRun {
  id: string;
  nodeId: string;
  status: NodeRunStatus;
  input?: JsonObject;
  output?: JsonObject;
  attempts: number;
  iteration?: number;
  error?: string;
  errorCode?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: RunStatus;
  variables: JsonObject;
  output?: JsonObject;
  nodeRuns: NodeRun[];
  iterations: Record<string, number>;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  errorCode?: string;
}

export interface WorkflowRunEvent {
  id: string;
  type: string;
  runId: string;
  workflowId: string;
  timestamp: string;
  nodeId?: string;
  nodeRun?: NodeRun;
  status?: RunStatus;
  currentNode?: string;
  iteration?: number;
  totalIterations?: number;
  output?: JsonObject;
  error?: string;
  errorCode?: string;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

export async function getRuns(baseUrl = apiBaseUrl): Promise<WorkflowRun[]> {
  const response = await fetch(baseUrl + '/runs');
  if (!response.ok) throw new Error('获取 Run 列表失败: ' + response.status);
  return (await response.json()) as WorkflowRun[];
}

export async function getRun(runId: string, baseUrl = apiBaseUrl): Promise<WorkflowRun> {
  const response = await fetch(baseUrl + '/runs/' + runId);
  if (!response.ok) throw new Error('获取 Run 详情失败: ' + response.status);
  return (await response.json()) as WorkflowRun;
}

export function subscribeRunEvents(
  runId: string,
  onEvent: (event: WorkflowRunEvent) => void,
  onError?: (error: Event) => void,
  baseUrl = apiBaseUrl,
): EventSource {
  const source = new EventSource(baseUrl + '/runs/' + runId + '/events');
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as WorkflowRunEvent);
    } catch {
      // ignore parse errors
    }
  };
  for (const type of [
    'RUN_STARTED',
    'NODE_STARTED',
    'NODE_COMPLETED',
    'NODE_FAILED',
    'LOOP_STARTED',
    'LOOP_ITERATION',
    'LOOP_CONTINUED',
    'LOOP_STOPPED',
    'RUN_COMPLETED',
    'RUN_FAILED',
    'RUN_CANCELLED',
  ]) {
    source.addEventListener(type, (message) => {
      try {
        onEvent(JSON.parse((message as MessageEvent).data) as WorkflowRunEvent);
      } catch {
        // ignore parse errors
      }
    });
  }
  if (onError) source.onerror = onError;
  return source;
}
