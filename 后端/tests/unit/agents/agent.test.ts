import { describe, expect, it } from 'vitest';
import { createWorkflowDefinition } from '@ai-workflow/shared-types';
import { AgentExecutionError, ProviderAgentExecutor } from '../../../src/agents/index.js';
import { MockModelProvider, ModelProviderRegistry } from '../../../src/agents/model-provider.js';

function agentNode() {
  const node = createWorkflowDefinition().nodes.find((item) => item.type === 'agent');
  if (!node || node.type !== 'agent') throw new Error('test agent missing');
  return node;
}

describe('ProviderAgentExecutor', () => {
  it('passes Agent input and config to the ModelProvider', async () => {
    const requests: unknown[] = [];
    const provider = new MockModelProvider((request) => {
      requests.push(request);
      return { content: 'RAG is retrieval augmented generation.' };
    });
    const executor = new ProviderAgentExecutor({
      providers: new ModelProviderRegistry([provider]),
    });
    const result = await executor.execute({
      node: agentNode(),
      input: 'Explain RAG',
      variables: { query: 'Explain RAG' },
      nodeOutputs: {},
    });
    expect(result.output).toEqual({ response: 'RAG is retrieval augmented generation.' });
    expect(result.rawText).toContain('retrieval');
    expect(requests[0]).toMatchObject({ input: 'Explain RAG', model: 'gpt-4o-mini' });
  });

  it('parses structured Agent output when outputSchema is configured', async () => {
    const node = agentNode();
    node.config.outputSchema = { type: 'object', properties: { passed: { type: 'boolean' } } };
    const executor = new ProviderAgentExecutor({
      providers: new ModelProviderRegistry([
        new MockModelProvider(() => ({ content: '{"passed":true}' })),
      ]),
    });
    await expect(
      executor.execute({ node, input: 'review', variables: {}, nodeOutputs: {} }),
    ).resolves.toMatchObject({
      output: { passed: true },
    });
  });

  it('classifies invalid structured output as a parsing error', async () => {
    const node = agentNode();
    node.config.outputSchema = { type: 'object' };
    const executor = new ProviderAgentExecutor({
      providers: new ModelProviderRegistry([
        new MockModelProvider(() => ({ content: 'not-json' })),
      ]),
    });
    await expect(
      executor.execute({ node, input: 'review', variables: {}, nodeOutputs: {} }),
    ).rejects.toMatchObject<Partial<AgentExecutionError>>({
      code: 'PARSING_ERROR',
      retryable: false,
    });
  });

  it('classifies provider timeout and aborts the underlying request', async () => {
    const node = agentNode();
    node.config.timeout = 5;
    let aborted = false;
    const executor = new ProviderAgentExecutor({
      providers: new ModelProviderRegistry([
        new MockModelProvider(
          (request) =>
            new Promise((resolve) => {
              request.signal?.addEventListener('abort', () => {
                aborted = true;
                resolve({ content: 'aborted' });
              });
            }),
        ),
      ]),
    });
    await expect(
      executor.execute({ node, input: 'slow', variables: {}, nodeOutputs: {} }),
    ).rejects.toMatchObject<Partial<AgentExecutionError>>({
      code: 'TIMEOUT',
      retryable: true,
    });
    expect(aborted).toBe(true);
  });

  it('propagates caller cancellation to the ModelProvider', async () => {
    const node = agentNode();
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const executor = new ProviderAgentExecutor({
      providers: new ModelProviderRegistry([
        new MockModelProvider((request) => {
          providerSignal = request.signal;
          return new Promise(() => {});
        }),
      ]),
    });
    const running = executor.execute({
      node,
      input: 'cancel',
      variables: {},
      nodeOutputs: {},
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(running).rejects.toMatchObject<Partial<AgentExecutionError>>({
      code: 'CANCELLED',
    });
    expect(providerSignal?.aborted).toBe(true);
  });
});
