import { describe, expect, it } from 'vitest';
import { InMemoryRunMonitor } from '../../../src/runs/run-monitor.js';
import type { WorkflowRunResult } from '../../../src/workflow/runtime/types.js';

function makeRun(id: string, status: WorkflowRunResult['status'] = 'RUNNING'): WorkflowRunResult {
  return {
    id,
    workflowId: 'wf-1',
    status,
    variables: {},
    nodeRuns: [],
    iterations: {},
    checkpoints: [],
    startedAt: new Date().toISOString(),
  };
}

describe('InMemoryRunMonitor', () => {
  it('registers and retrieves runs', () => {
    const monitor = new InMemoryRunMonitor();
    const run = makeRun('run-1');
    monitor.register(run);

    expect(monitor.get('run-1')).toBe(run);
    expect(monitor.get('run-2')).toBeUndefined();
  });

  it('lists runs sorted by startedAt descending', () => {
    const monitor = new InMemoryRunMonitor();
    const old = { ...makeRun('run-old'), startedAt: '2024-01-01T00:00:00.000Z' };
    const newer = { ...makeRun('run-new'), startedAt: '2024-06-01T00:00:00.000Z' };
    monitor.register(old);
    monitor.register(newer);

    const list = monitor.list();
    expect(list[0]?.id).toBe('run-new');
    expect(list[1]?.id).toBe('run-old');
  });

  it('updates runs in place', () => {
    const monitor = new InMemoryRunMonitor();
    const run = makeRun('run-1', 'RUNNING');
    monitor.register(run);
    const finished = { ...run, status: 'SUCCESS' as const, finishedAt: new Date().toISOString() };
    monitor.update(finished);

    expect(monitor.get('run-1')?.status).toBe('SUCCESS');
  });

  it('delivers events through the event bus', () => {
    const monitor = new InMemoryRunMonitor();
    const received: string[] = [];
    monitor.subscribe('run-1', (event) => received.push(event.type));

    monitor.events.emit({
      id: 'e1',
      type: 'RUN_STARTED',
      runId: 'run-1',
      workflowId: 'wf-1',
      timestamp: new Date().toISOString(),
    });

    expect(received).toEqual(['RUN_STARTED']);
  });
});
