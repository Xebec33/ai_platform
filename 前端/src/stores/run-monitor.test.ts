import { describe, expect, it } from 'vitest';
import type { WorkflowRun, WorkflowRunEvent } from '../api/runs';
import { applyRunEvent } from './run-monitor';

const baseRun: WorkflowRun = {
  id: 'run-1',
  workflowId: 'workflow-1',
  status: 'RUNNING',
  variables: {},
  nodeRuns: [],
  iterations: {},
  startedAt: '2026-01-01T00:00:00.000Z',
};

function event(partial: Partial<WorkflowRunEvent>): WorkflowRunEvent {
  return {
    id: 'event-1',
    type: 'NODE_STARTED',
    runId: 'run-1',
    workflowId: 'workflow-1',
    timestamp: '2026-01-01T00:00:01.000Z',
    ...partial,
  };
}

describe('applyRunEvent', () => {
  it('adds and merges NodeRun details from node events', () => {
    const started = applyRunEvent(
      baseRun,
      event({
        nodeRun: {
          id: 'node-run-1',
          nodeId: 'agent-1',
          status: 'RUNNING',
          attempts: 1,
          startedAt: '2026-01-01T00:00:01.000Z',
        },
      }),
    );
    const completed = applyRunEvent(
      started,
      event({
        type: 'NODE_COMPLETED',
        nodeRun: {
          id: 'node-run-1',
          nodeId: 'agent-1',
          status: 'SUCCESS',
          attempts: 1,
          startedAt: '2026-01-01T00:00:01.000Z',
          finishedAt: '2026-01-01T00:00:02.000Z',
          output: { answer: 'ok' },
        },
      }),
    );

    expect(completed.nodeRuns).toHaveLength(1);
    expect(completed.nodeRuns[0]).toMatchObject({ status: 'SUCCESS', output: { answer: 'ok' } });
  });

  it('updates run status, output, errors and loop iterations', () => {
    const withNode = applyRunEvent(
      baseRun,
      event({
        nodeRun: {
          id: 'loop-run-1',
          nodeId: 'loop-1',
          status: 'RUNNING',
          attempts: 1,
          startedAt: '2026-01-01T00:00:01.000Z',
        },
      }),
    );
    const iterated = applyRunEvent(
      withNode,
      event({ type: 'LOOP_ITERATION', nodeId: 'loop-1', iteration: 2 }),
    );
    const updated = applyRunEvent(
      iterated,
      event({
        type: 'RUN_COMPLETED',
        status: 'SUCCESS',
        output: { result: 'done' },
      }),
    );

    expect(updated).toMatchObject({
      status: 'SUCCESS',
      output: { result: 'done' },
      iterations: { 'loop-1': 2 },
      finishedAt: '2026-01-01T00:00:01.000Z',
    });
    expect(updated.nodeRuns[0]?.iteration).toBe(2);
  });
});
