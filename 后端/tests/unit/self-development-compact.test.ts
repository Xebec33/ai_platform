import { describe, expect, it } from 'vitest';
import { compactRunResult } from '../../src/self-development/compact.js';
import type { DevelopmentSessionResult } from '../../src/self-development/session.js';

describe('compactRunResult', () => {
  const bigText = 'x'.repeat(50_000);

  const result: DevelopmentSessionResult = {
    workspace: {
      id: 'task-1',
      repositoryRoot: '/repo',
      path: '/ws/task-1',
      baseBranch: 'main',
      branch: 'agent/task-1',
      createdAt: '2026-09-16T00:00:00.000Z',
    },
    merged: true,
    run: {
      id: 'run-1',
      workflowId: 'self-development-v1',
      status: 'SUCCESS',
      variables: { secret: bigText },
      nodeRuns: [
        {
          id: 'n1',
          nodeId: 'coding-agent',
          status: 'SUCCESS',
          attempts: 1,
          startedAt: '2026-09-16T00:00:00.000Z',
          input: { huge: bigText },
          output: {
            summary: '开发完成',
            rawOutput: bigText,
            events: [
              { type: 'step_start' },
              { type: 'text', part: { type: 'text', text: bigText } },
              { type: 'tool', part: { type: 'tool', tool: 'shell', state: { output: bigText } } },
              { type: 'ignored', something: bigText },
            ],
            exitCode: 0,
          },
        },
      ],
      iterations: {},
      checkpoints: [{ id: 'c1', runId: 'run-1', workflowId: 'w', currentNode: 'x', variables: { a: bigText } }],
      startedAt: '2026-09-16T00:00:00.000Z',
    },
  };

  it('keeps display fields but drops checkpoints, variables and node inputs', () => {
    const compacted = compactRunResult(result);
    expect(compacted.run.checkpoints).toEqual([]);
    expect(compacted.run.variables).toEqual({});
    expect(compacted.run.nodeRuns[0].input).toBeUndefined();
    expect(compacted.run.nodeRuns[0].output?.summary).toBe('开发完成');
    expect(compacted.merged).toBe(true);
  });

  it('compacts events to the fields the frontend renders', () => {
    const events = compactRunResult(result).run.nodeRuns[0].output?.events as Array<Record<string, unknown>>;
    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({ type: 'step_start' });
    expect(events[1]).toEqual({
      type: 'text',
      part: { type: 'text', text: 'x'.repeat(400) + '…' },
    });
    expect(events[2]).toEqual({ type: 'tool', part: { type: 'tool', tool: 'shell' } });
    expect(events[3]).toEqual({ type: 'ignored' });
  });

  it('drops rawOutput and keeps the overall payload small', () => {
    const compacted = compactRunResult(result);
    expect('rawOutput' in (compacted.run.nodeRuns[0].output ?? {})).toBe(false);
    expect(JSON.stringify(compacted).length).toBeLessThan(5_000);
  });

  it('does not mutate the stored result', () => {
    compactRunResult(result);
    expect(result.run.nodeRuns[0].input).toMatchObject({ huge: bigText });
    expect(result.run.checkpoints).toHaveLength(1);
  });
});
