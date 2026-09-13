import type { WorkflowRunResult } from '../workflow/runtime/types.js';
import { RunEventBus, type WorkflowRunEvent } from '../workflow/runtime/events.js';

export interface RunMonitor {
  readonly events: RunEventBus;
  register(run: WorkflowRunResult): void;
  update(run: WorkflowRunResult): void;
  get(runId: string): WorkflowRunResult | undefined;
  list(): WorkflowRunResult[];
  subscribe(runId: string, listener: (event: WorkflowRunEvent) => void): () => void;
}

export class InMemoryRunMonitor implements RunMonitor {
  readonly events = new RunEventBus();
  private readonly runs = new Map<string, WorkflowRunResult>();

  register(run: WorkflowRunResult): void {
    this.runs.set(run.id, run);
  }

  update(run: WorkflowRunResult): void {
    this.runs.set(run.id, run);
  }

  get(runId: string): WorkflowRunResult | undefined {
    return this.runs.get(runId);
  }

  list(): WorkflowRunResult[] {
    return [...this.runs.values()].sort((left, right) =>
      right.startedAt.localeCompare(left.startedAt),
    );
  }

  subscribe(runId: string, listener: (event: WorkflowRunEvent) => void): () => void {
    return this.events.subscribe(runId, listener);
  }
}
