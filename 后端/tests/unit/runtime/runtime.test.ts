import { describe, expect, it, vi } from 'vitest';
import { AgentExecutionError } from '../../../src/agents/index.js';
import { createWorkflowDefinition, type WorkflowDefinition } from '@ai-workflow/shared-types';
import {
  createWorkflowRuntime,
  WorkflowRuntime,
  WorkflowValidationError,
} from '../../../src/workflow/runtime/index.js';

function workflow(): WorkflowDefinition {
  return createWorkflowDefinition('runtime-demo', 'Runtime Demo');
}

describe('WorkflowRuntime', () => {
  it('executes Start -> Agent -> End and records node runs', async () => {
    const executor = vi.fn(async ({ input }: { input: unknown }) => ({
      output: { answer: input },
    }));
    const result = await createWorkflowRuntime(workflow(), {
      agentExecutor: executor,
      runIdFactory: () => 'run-1',
    }).execute({ variables: { prompt: 'hello' } });
    expect(result).toMatchObject({ id: 'run-1', workflowId: 'runtime-demo', status: 'SUCCESS' });
    expect(result.nodeRuns.map((run) => run.nodeId)).toEqual(['start-1', 'agent-1', 'end-1']);
    expect(result.nodeRuns.every((run) => run.status === 'SUCCESS' && run.finishedAt)).toBe(true);
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ input: { prompt: 'hello' } }));
    expect(result.output).toEqual({ answer: { prompt: 'hello' } });
  });

  it('resolves agent input and writes outputKey into variables', async () => {
    const definition = workflow();
    const agent = definition.nodes.find((node) => node.type === 'agent');
    if (!agent || agent.type !== 'agent') throw new Error('test agent missing');
    agent.config.input = '{{variables.query}}';
    agent.config.outputKey = 'answer';
    const result = await createWorkflowRuntime(definition, {
      agentExecutor: async ({ input }) => ({ output: { text: input } }),
    }).run({ variables: { query: 'RAG' } });
    expect(result.status).toBe('SUCCESS');
    expect(result.nodeRuns[1]?.input).toBe('RAG');
    expect(result.variables.answer).toEqual({ text: 'RAG' });
  });

  it('retries a failed Agent and succeeds', async () => {
    let calls = 0;
    const result = await createWorkflowRuntime(workflow(), {
      maxAgentRetries: 1,
      agentExecutor: async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary');
        return { output: { ok: true } };
      },
    }).run();
    expect(result.status).toBe('SUCCESS');
    expect(calls).toBe(2);
    expect(result.nodeRuns[1]?.attempts).toBe(2);
  });

  it('returns failed run when Agent throws after retries', async () => {
    const result = await createWorkflowRuntime(workflow(), {
      agentExecutor: async () => {
        throw new Error('agent failed');
      },
    }).run();
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('agent failed');
    expect(result.nodeRuns[1]).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      error: 'agent failed',
    });
  });

  it('uses the default ModelProvider-backed Agent executor', async () => {
    const result = await createWorkflowRuntime(workflow()).run({ variables: { prompt: 'hello' } });
    expect(result.status).toBe('SUCCESS');
    expect(result.output).toEqual({ response: 'Mock response: {"prompt":"hello"}' });
  });

  it('records classified Agent errors in NodeRun', async () => {
    const result = await createWorkflowRuntime(workflow(), {
      agentExecutor: async () => {
        throw new AgentExecutionError('PARSING_ERROR', 'invalid output');
      },
    }).run();
    expect(result.status).toBe('FAILED');
    expect(result.nodeRuns[1]).toMatchObject({
      errorCode: 'PARSING_ERROR',
      error: 'invalid output',
    });
  });

  it('rejects invalid workflow before execution', () => {
    expect(
      () =>
        new WorkflowRuntime({
          ...workflow(),
          nodes: workflow().nodes.filter((node) => node.type !== 'start'),
        }),
    ).toThrow(WorkflowValidationError);
  });

  it('executes a Loop until the second iteration passes and persists checkpoints', async () => {
    const definition = loopWorkflow(3);
    let calls = 0;
    const save = vi.fn();
    const result = await createWorkflowRuntime(definition, {
      agentExecutor: async () => {
        calls += 1;
        return { output: { passed: calls >= 2 } };
      },
      checkpointStore: { save },
    }).run();

    expect(result.status).toBe('SUCCESS');
    expect(result.iterations['loop-1']).toBe(2);
    expect(result.nodeRuns.filter((run) => run.nodeId === 'review-agent')).toHaveLength(2);
    expect(
      result.nodeRuns.find((run) => run.nodeId === 'review-agent' && run.iteration === 1),
    ).toBeDefined();
    expect(
      result.nodeRuns.find((run) => run.nodeId === 'review-agent' && run.iteration === 2),
    ).toBeDefined();
    expect(result.checkpoints).toHaveLength(3);
    expect(save).toHaveBeenCalledTimes(3);
    expect(result.output).toEqual({ passed: true });
  });

  it('fails a Loop after maxIterations without executing another iteration', async () => {
    const definition = loopWorkflow(3);
    let calls = 0;
    const result = await createWorkflowRuntime(definition, {
      agentExecutor: async () => {
        calls += 1;
        return { output: { passed: false } };
      },
    }).run();

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('MAX_ITERATIONS_REACHED');
    expect(result.iterations['loop-1']).toBe(3);
    expect(calls).toBe(3);
    expect(result.nodeRuns.filter((run) => run.nodeId === 'review-agent')).toHaveLength(3);
    expect(result.nodeRuns.some((run) => run.nodeId === 'end-1')).toBe(false);
  });

  it('uses Loop retry for a failed iteration without changing Agent retry count', async () => {
    const definition = loopWorkflow(1);
    const loop = definition.nodes.find((node) => node.id === 'loop-1');
    if (!loop || loop.type !== 'loop') throw new Error('test loop missing');
    loop.config.retry = 1;
    let calls = 0;
    const result = await createWorkflowRuntime(definition, {
      agentExecutor: async () => {
        calls += 1;
        if (calls === 1) throw new Error('iteration failed');
        return { output: { passed: true } };
      },
      maxAgentRetries: 0,
    }).run();

    expect(result.status).toBe('SUCCESS');
    expect(calls).toBe(2);
    expect(result.nodeRuns.find((run) => run.nodeId === 'loop-1')?.attempts).toBe(2);
    expect(result.nodeRuns.filter((run) => run.nodeId === 'review-agent')).toHaveLength(2);
    expect(
      result.nodeRuns
        .filter((run) => run.nodeId === 'review-agent')
        .every((run) => run.attempts === 1),
    ).toBe(true);
  });

  it('rejects invalid workflow before execution', () => {
    expect(
      () =>
        new WorkflowRuntime({
          ...workflow(),
          nodes: workflow().nodes.filter((node) => node.type !== 'start'),
        }),
    ).toThrow(WorkflowValidationError);
  });
});

function loopWorkflow(maxIterations: number): WorkflowDefinition {
  return {
    id: 'loop-demo',
    name: 'Loop Demo',
    version: 1,
    nodes: [
      { id: 'start-1', type: 'start', name: 'Start', config: {} },
      {
        id: 'loop-1',
        type: 'loop',
        name: 'Review Loop',
        config: {
          maxIterations,
          stopCondition: 'variables.review.passed == true',
          bodyNodeId: 'review-agent',
          exitNodeId: 'end-1',
        },
      },
      {
        id: 'review-agent',
        type: 'agent',
        name: 'Review',
        config: {
          model: 'mock',
          systemPrompt: 'Review the current state.',
          outputKey: 'review',
        },
      },
      { id: 'end-1', type: 'end', name: 'End', config: {} },
    ],
    edges: [
      { id: 'edge-start-loop', source: 'start-1', target: 'loop-1' },
      { id: 'edge-loop-body', source: 'loop-1', target: 'review-agent', condition: 'body' },
      { id: 'edge-loop-exit', source: 'loop-1', target: 'end-1', condition: 'exit' },
      { id: 'edge-agent-loop', source: 'review-agent', target: 'loop-1' },
    ],
    variables: {},
  };
}
