import type { JsonObject } from '@ai-workflow/shared-types';
import type { RunStatus, WorkflowNodeRun } from './types.js';

export type WorkflowEventType =
  | 'RUN_STARTED'
  | 'NODE_STARTED'
  | 'NODE_COMPLETED'
  | 'NODE_FAILED'
  | 'LOOP_STARTED'
  | 'LOOP_ITERATION'
  | 'LOOP_CONTINUED'
  | 'LOOP_STOPPED'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED'
  | 'RUN_CANCELLED';

export interface WorkflowRunEvent {
  id: string;
  type: WorkflowEventType;
  runId: string;
  workflowId: string;
  timestamp: string;
  nodeId?: string;
  nodeRun?: WorkflowNodeRun;
  status?: RunStatus;
  currentNode?: string;
  iteration?: number;
  output?: JsonObject;
  error?: string;
  errorCode?: string;
}

export interface WorkflowEventSink {
  emit(event: WorkflowRunEvent): void;
}

export type WorkflowEventListener = (event: WorkflowRunEvent) => void;

export class RunEventBus implements WorkflowEventSink {
  private readonly events = new Map<string, WorkflowRunEvent[]>();
  private readonly listeners = new Map<string, Set<WorkflowEventListener>>();
  private sequence = 0;

  emit(event: WorkflowRunEvent): void {
    const withId: WorkflowRunEvent = event.id
      ? event
      : { ...event, id: `${event.runId}-event-${++this.sequence}` };
    const history = this.events.get(event.runId) ?? [];
    history.push(withId);
    this.events.set(event.runId, history.slice(-200));
    for (const listener of this.listeners.get(event.runId) ?? []) listener(withId);
  }

  subscribe(runId: string, listener: WorkflowEventListener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<WorkflowEventListener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }

  history(runId: string): WorkflowRunEvent[] {
    return [...(this.events.get(runId) ?? [])];
  }

  clear(runId: string): void {
    this.events.delete(runId);
    this.listeners.delete(runId);
  }
}
