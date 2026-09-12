import { describe, expect, it, vi } from 'vitest';
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
