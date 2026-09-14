import { describe, expect, it } from 'vitest';
import { OpenAICompatibleProvider, createOpenAICompatibleProviderFromEnv } from '../../../src/agents/model-provider.js';
import type { ModelRequest } from '../../../src/agents/model-provider.js';

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    model: 'deepseek-chat',
    systemPrompt: 'You are helpful.',
    input: 'Hello',
    ...overrides,
  };
}

describe('OpenAICompatibleProvider', () => {
  it('sends OpenAI-compatible chat completion requests and parses tool calls', async () => {
    let receivedUrl = '';
    let receivedInit: RequestInit | undefined;
    const provider = new OpenAICompatibleProvider({
      id: 'deepseek',
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1/',
      fetchImpl: async (url, init) => {
        receivedUrl = String(url);
        receivedInit = init;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'I need to inspect the file.',
                  tool_calls: [
                    {
                      id: 'call-1',
                      function: { name: 'file_read', arguments: '{"path":"src/index.ts"}' },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    await expect(
      provider.complete(
        request({
          outputFormat: 'json',
          outputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          tools: [
            {
              name: 'file_read',
              description: 'read file',
              inputSchema: { type: 'object' },
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      content: 'I need to inspect the file.',
      toolCalls: [{ id: 'call-1', name: 'file_read', input: { path: 'src/index.ts' } }],
      usage: { totalTokens: 15 },
    });
    expect(receivedUrl).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(receivedInit?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    expect(JSON.parse(String(receivedInit?.body))).toMatchObject({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      tools: [{ type: 'function', function: { name: 'file_read' } }],
      response_format: { type: 'json_object' },
    });
  });

  it('builds alternating assistant and tool messages for each tool round', async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), { status: 200 });
      },
    });
    await provider.complete(
      request({
        toolHistory: [
          {
            toolCalls: [
              { id: 'call-1', name: 'file_read', input: { path: 'a.txt' } },
              { id: 'call-2', name: 'file_read', input: { path: 'b.txt' } },
            ],
            toolResults: [
              { toolCallId: 'call-1', name: 'file_read', ok: true, output: { content: 'a' } },
              { toolCallId: 'call-2', name: 'file_read', ok: true, output: { content: 'b' } },
            ],
          },
          {
            toolCalls: [{ id: 'call-3', name: 'shell', input: { command: 'ls' } }],
            toolResults: [{ toolCallId: 'call-3', name: 'shell', ok: false, error: { code: 'E', message: 'boom' } }],
          },
        ],
      }),
    );
    expect(body?.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'file_read', arguments: '{"path":"a.txt"}' } },
          { id: 'call-2', type: 'function', function: { name: 'file_read', arguments: '{"path":"b.txt"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call-1', content: '{"content":"a"}' },
      { role: 'tool', tool_call_id: 'call-2', content: '{"content":"b"}' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call-3', type: 'function', function: { name: 'shell', arguments: '{"command":"ls"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call-3', content: '{"error":{"code":"E","message":"boom"}}' },
    ]);
  });

  it('does not force object mode when JSON output has no declared fields', async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: '1' } }] }), { status: 200 });
      },
    });
    await provider.complete(request({ outputFormat: 'json', outputSchema: { type: 'object', properties: {} } }));
    expect(body).not.toHaveProperty('response_format');
  });

  it('classifies provider HTTP failures and API key configuration', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }),
    });
    await expect(provider.complete(request())).rejects.toMatchObject({
      message: 'rate limited',
      retryable: true,
    });
    expect(() =>
      createOpenAICompatibleProviderFromEnv({ MODEL_PROVIDER: 'deepseek' }),
    ).toThrow('OPENAI_API_KEY');
  });

  it('selects DeepSeek-compatible settings from environment variables', () => {
    const configured = createOpenAICompatibleProviderFromEnv({
      MODEL_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'test-key',
      OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
      OPENAI_MODEL: 'deepseek-chat',
      OPENAI_PROVIDER_ID: 'deepseek',
    });
    expect(configured?.model).toBe('deepseek-chat');
    expect(configured?.provider.id).toBe('deepseek');
  });

  it('propagates caller cancellation', async () => {
    const controller = new AbortController();
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      fetchImpl: async (_url, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    });
    const running = provider.complete(request({ signal: controller.signal }));
    controller.abort();
    await expect(running).rejects.toMatchObject({ message: 'Provider 请求已取消', retryable: false });
  });
});
