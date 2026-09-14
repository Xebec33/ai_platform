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

  it('emits LOOP_ITERATION events with progress metadata', async () => {
    const events: Array<{ type: string; iteration?: number; totalIterations?: number }> = [];
    const result = await createWorkflowRuntime(loopWorkflow(2), {
      eventSink: {
        emit: (event) => events.push(event),
      },
      agentExecutor: async ({ node }) => ({
        output: {
          passed: node.id === 'review-agent' && events.some((event) => event.iteration === 2),
        },
      }),
    }).run();

    expect(result.status).toBe('SUCCESS');
    expect(events.filter((event) => event.type === 'LOOP_ITERATION')).toEqual([
      expect.objectContaining({ iteration: 1, totalIterations: 2 }),
      expect.objectContaining({ iteration: 2, totalIterations: 2 }),
    ]);
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

  it('persists the final FAILED status of a Loop body node', async () => {
    const nodeRuns: Array<{ runId: string; nodeId: string; status: string }> = [];
    const persistence = {
      saveWorkflow: async () => {},
      saveRun: async () => {},
      saveNodeRun: async (runId: string, nodeRun: { nodeId: string; status: string }) => {
        nodeRuns.push({ runId, nodeId: nodeRun.nodeId, status: nodeRun.status });
      },
      saveState: async () => {},
      saveCheckpoint: async () => {},
    };
    const result = await createWorkflowRuntime(loopWorkflow(1), {
      persistence,
      agentExecutor: async () => {
        throw new Error('body failed');
      },
    }).run();
    expect(result.status).toBe('FAILED');
    expect(
      nodeRuns.filter((run) => run.nodeId === 'review-agent').map((run) => run.status),
    ).toEqual(['RUNNING', 'FAILED']);
  });

  it('persists State after each successful Loop body node', async () => {
    const states: Array<{ currentNode?: string; variables: Record<string, unknown> }> = [];
    const result = await createWorkflowRuntime(loopWorkflow(1), {
      persistence: {
        saveWorkflow: async () => {},
        saveRun: async () => {},
        saveNodeRun: async () => {},
        saveState: async (state) =>
          states.push({ currentNode: state.currentNode, variables: state.variables }),
        saveCheckpoint: async () => {},
      },
      agentExecutor: async () => ({ output: { passed: true } }),
    }).run();
    expect(result.status).toBe('SUCCESS');
    expect(states.some((state) => state.currentNode === 'loop-1')).toBe(true);
    expect(states.length).toBeGreaterThan(3);
  });

  it('finalizes a failed Loop body node instead of leaving it RUNNING', async () => {
    const result = await createWorkflowRuntime(loopWorkflow(2), {
      agentExecutor: async () => {
        throw new Error('body failed');
      },
    }).run();
    const bodyRuns = result.nodeRuns.filter((run) => run.nodeId === 'review-agent');
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('MAX_ITERATIONS_REACHED');
    expect(bodyRuns).toHaveLength(2);
    expect(bodyRuns.every((run) => run.status === 'FAILED' && run.finishedAt && run.error)).toBe(
      true,
    );
  });

  it('fails immediately when a Loop has no exit edge', async () => {
    const definition = loopWorkflow(2);
    const runtime = createWorkflowRuntime(definition);
    definition.edges = definition.edges.filter((edge) => edge.id !== 'edge-loop-exit');
    const result = await runtime.run();
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('LOOP_CONFIG_ERROR');
    expect(result.nodeRuns.some((run) => run.nodeId === 'review-agent')).toBe(false);
  });

  it('uses Loop timeout for a slow body Agent', async () => {
    const definition = loopWorkflow(1);
    const loop = definition.nodes.find((node) => node.id === 'loop-1');
    if (!loop || loop.type !== 'loop') throw new Error('test loop missing');
    loop.config.timeout = 5;
    const result = await createWorkflowRuntime(definition, {
      agentExecutor: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { output: { passed: true } };
      },
    }).run();
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('LOOP_TIMEOUT');
  });

  it('cancels an Agent wait immediately when its AbortSignal is aborted', async () => {
    const controller = new AbortController();
    const running = createWorkflowRuntime(workflow(), {
      agentExecutor: async () => new Promise(() => {}),
    }).run({ signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    const result = await running;
    expect(result.status).toBe('CANCELLED');
    expect(result.errorCode).toBe('CANCELLED');
    expect(result.nodeRuns[1]).toMatchObject({ status: 'FAILED', errorCode: 'CANCELLED' });
    expect(result.nodeRuns.some((run) => run.nodeId === 'end-1')).toBe(false);
  });

  it('returns Node timeout and finalizes the timed out Agent', async () => {
    const result = await createWorkflowRuntime(workflow(), {
      agentTimeoutMs: 5,
      agentExecutor: async () => new Promise(() => {}),
    }).run();
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('NODE_TIMEOUT');
    expect(result.nodeRuns[1]).toMatchObject({ status: 'FAILED', errorCode: 'NODE_TIMEOUT' });
    expect(result.nodeRuns[1]?.finishedAt).toBeDefined();
  });

  it('keeps the original workflow failure when persistence also fails', async () => {
    const result = await createWorkflowRuntime(workflow(), {
      persistence: {
        saveWorkflow: async () => {
          throw new Error('database offline');
        },
        saveRun: async () => {
          throw new Error('database offline');
        },
        saveNodeRun: async () => {
          throw new Error('database offline');
        },
        saveState: async () => {
          throw new Error('database offline');
        },
        saveCheckpoint: async () => {},
      },
      agentExecutor: async () => {
        throw new Error('agent failed');
      },
    }).run();
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('agent failed');
    expect(result.persistenceError).toContain('database offline');
  });

  it('fails the run when CheckpointStore cannot save', async () => {
    const result = await createWorkflowRuntime(loopWorkflow(1), {
      checkpointStore: {
        save: async () => {
          throw new Error('checkpoint offline');
        },
      },
    }).run();
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('CHECKPOINT_ERROR');
    expect(result.nodeRuns.find((run) => run.nodeId === 'loop-1')).toMatchObject({
      status: 'FAILED',
      errorCode: 'CHECKPOINT_ERROR',
    });
  });

  it('returns Workflow timeout while an Agent Promise is pending', async () => {
    const result = await createWorkflowRuntime(workflow(), {
      workflowTimeoutMs: 5,
      agentExecutor: async () => new Promise(() => {}),
    }).run();
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('WORKFLOW_TIMEOUT');
  });

  it.each([true, false])('routes Condition %s branch correctly', async (flag) => {
    const result = await createWorkflowRuntime(conditionWorkflow(flag), {
      agentExecutor: async ({ node }) => ({
        output: { branch: node.id === 'true-agent' ? 'true' : 'false' },
      }),
    }).run();
    expect(result.status).toBe('SUCCESS');
    expect(result.output).toEqual({ branch: flag ? 'true' : 'false' });
  });

  it('finalizes Condition and End node runs and emits completed events', async () => {
    const persisted: Array<{ nodeId: string; status: string }> = [];
    const events: Array<{ type: string; nodeId?: string; status?: string }> = [];
    const result = await createWorkflowRuntime(conditionWorkflowWithAgentOutput('1'), {
      persistence: {
        saveWorkflow: async () => {},
        saveRun: async () => {},
        saveNodeRun: async (_runId, nodeRun) => persisted.push({ nodeId: nodeRun.nodeId, status: nodeRun.status }),
        saveState: async () => {},
        saveCheckpoint: async () => {},
      },
      eventSink: { emit: (event) => events.push({ type: event.type, nodeId: event.nodeId, status: event.nodeRun?.status }) },
      agentExecutor: async ({ node }) => ({
        output: node.id === 'source-agent' ? { decide: '1' } : { branch: node.id },
      }),
    }).run();

    expect(result.status).toBe('SUCCESS');
    expect(result.nodeRuns.filter((run) => ['condition-1', 'end-1'].includes(run.nodeId))).toEqual([
      expect.objectContaining({ nodeId: 'condition-1', status: 'SUCCESS', finishedAt: expect.any(String) }),
      expect.objectContaining({ nodeId: 'end-1', status: 'SUCCESS', finishedAt: expect.any(String) }),
    ]);
    expect(persisted.filter((run) => ['condition-1', 'end-1'].includes(run.nodeId))).toEqual([
      { nodeId: 'condition-1', status: 'RUNNING' },
      { nodeId: 'condition-1', status: 'SUCCESS' },
      { nodeId: 'end-1', status: 'RUNNING' },
      { nodeId: 'end-1', status: 'SUCCESS' },
    ]);
    expect(events.filter((event) => ['condition-1', 'end-1'].includes(event.nodeId))).toEqual([
      expect.objectContaining({ type: 'NODE_STARTED', nodeId: 'condition-1', status: 'RUNNING' }),
      expect.objectContaining({ type: 'NODE_COMPLETED', nodeId: 'condition-1', status: 'SUCCESS' }),
      expect.objectContaining({ type: 'NODE_STARTED', nodeId: 'end-1', status: 'RUNNING' }),
      expect.objectContaining({ type: 'NODE_COMPLETED', nodeId: 'end-1', status: 'SUCCESS' }),
    ]);
  });

  it('routes a UI condition parameter from the previous Agent output', async () => {
    const workflow = conditionWorkflowWithAgentOutput('1');
    const result = await createWorkflowRuntime(workflow, {
      agentExecutor: async ({ node }) => ({
        output: node.id === 'source-agent' ? { decide: '1' } : { branch: node.id },
      }),
    }).run();

    expect(result.status).toBe('SUCCESS');
    expect(result.output).toEqual({ branch: 'true-agent' });
    expect(result.nodeRuns.map((run) => run.nodeId)).toEqual([
      'start-1',
      'source-agent',
      'condition-1',
      'true-agent',
      'end-1',
    ]);
  });

  it('routes numeric Agent output without treating the comparison value as a string', async () => {
    const workflow = conditionWorkflowWithAgentOutput('1');
    const result = await createWorkflowRuntime(workflow, {
      agentExecutor: async ({ node }) => ({
        output: node.id === 'source-agent' ? { decide: 1 } : { branch: node.id },
      }),
    }).run();

    expect(result.status).toBe('SUCCESS');
    expect(result.output).toEqual({ branch: 'true-agent' });
  });

  it('restores Loop variables before retrying a failed iteration', async () => {
    const seen: unknown[] = [];
    let secondCalls = 0;
    const result = await createWorkflowRuntime(retryWorkflow(), {
      agentExecutor: async ({ node, variables }) => {
        if (node.id === 'first-agent') {
          seen.push(variables.transient);
          if (seen.length === 1) variables.transient = 'dirty';
          return { output: { value: 1 } };
        }
        secondCalls += 1;
        if (secondCalls === 1) throw new Error('second failed');
        return { output: { ok: true } };
      },
    }).run();
    expect(result.status).toBe('SUCCESS');
    expect(result.error).toBeUndefined();
    expect(seen).toEqual([undefined, undefined]);
    expect(result.variables.transient).toBeUndefined();
    expect(result.variables.second).toEqual({ ok: true });
  });
});

function startConfig() {
  return {
    inputParameters: [
      { name: 'inputs', type: 'string', required: true, system: true, description: '工作流总输入。' },
    ],
  };
}

function conditionWorkflow(flag: boolean): WorkflowDefinition {
  return {
    id: 'condition-demo',
    name: 'Condition Demo',
    version: 1,
    variables: { flag },
    nodes: [
      { id: 'start-1', type: 'start', name: 'Start', config: startConfig() },
      {
        id: 'condition-1',
        type: 'condition',
        name: 'Condition',
        config: { expression: 'variables.flag == true' },
      },
      {
        id: 'true-agent',
        type: 'agent',
        name: 'True',
        config: { model: 'mock', systemPrompt: 'true', outputKey: 'result' },
      },
      {
        id: 'false-agent',
        type: 'agent',
        name: 'False',
        config: { model: 'mock', systemPrompt: 'false', outputKey: 'result' },
      },
      { id: 'end-1', type: 'end', name: 'End', config: {} },
    ],
    edges: [
      { id: 'e1', source: 'start-1', target: 'condition-1' },
      { id: 'e2', source: 'condition-1', target: 'true-agent', condition: 'true' },
      { id: 'e3', source: 'condition-1', target: 'false-agent', condition: 'false' },
      { id: 'e4', source: 'true-agent', target: 'end-1' },
      { id: 'e5', source: 'false-agent', target: 'end-1' },
    ],
  };
}

function conditionWorkflowWithAgentOutput(comparisonValue: string): WorkflowDefinition {
  const workflow = conditionWorkflow(false);
  workflow.nodes.splice(1, 0, {
    id: 'source-agent',
    type: 'agent',
    name: 'Source Agent',
    config: { model: 'mock', systemPrompt: 'source' },
  });
  workflow.nodes = workflow.nodes.map((node) =>
    node.id === 'condition-1'
      ? {
          ...node,
          config: {
            parameter: 'decide',
            relation: 'equals',
            comparisonValue,
            expression: `decide === ${JSON.stringify(comparisonValue)}`,
          },
        }
      : node,
  );
  workflow.edges = workflow.edges.flatMap((edge) =>
    edge.id === 'e1'
      ? [
          { ...edge, target: 'source-agent' },
          { id: 'e-source-condition', source: 'source-agent', target: 'condition-1' },
        ]
      : [edge],
  );
  return workflow;
}

function retryWorkflow(): WorkflowDefinition {
  const definition = loopWorkflow(1);
  definition.nodes.splice(
    2,
    1,
    {
      id: 'first-agent',
      type: 'agent',
      name: 'First',
      config: { model: 'mock', systemPrompt: 'first', outputKey: 'first' },
    },
    {
      id: 'second-agent',
      type: 'agent',
      name: 'Second',
      config: { model: 'mock', systemPrompt: 'second', outputKey: 'second' },
    },
  );
  const loop = definition.nodes.find((node) => node.id === 'loop-1');
  if (loop && loop.type === 'loop') {
    loop.config.bodyNodeId = 'first-agent';
    loop.config.retry = 1;
    loop.config.stopCondition = 'variables.second.ok == true';
  }
  definition.edges = [
    { id: 'e1', source: 'start-1', target: 'loop-1' },
    { id: 'e2', source: 'loop-1', target: 'first-agent', condition: 'body' },
    { id: 'e3', source: 'loop-1', target: 'end-1', condition: 'exit' },
    { id: 'e4', source: 'first-agent', target: 'second-agent' },
    { id: 'e5', source: 'second-agent', target: 'loop-1' },
  ];
  return definition;
}

function loopWorkflow(maxIterations: number): WorkflowDefinition {
  return {
    id: 'loop-demo',
    name: 'Loop Demo',
    version: 1,
    nodes: [
      { id: 'start-1', type: 'start', name: 'Start', config: startConfig() },
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
