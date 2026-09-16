import type { JsonObject, JsonValue } from '@ai-workflow/shared-types';
import type { TokenUsage } from './agent.js';
import { createOpenAICompatibleProviderFromEnv } from './openai-compatible-provider.js';

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export interface ModelToolCall {
  id: string;
  name: string;
  input: JsonObject;
}

export interface ModelToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  output?: JsonObject;
  error?: { code: string; message: string };
}

export interface ModelRequest {
  model: string;
  systemPrompt: string;
  input: JsonValue;
  temperature?: number;
  maxTokens?: number;
  outputFormat?: 'text' | 'json';
  outputSchema?: JsonObject;
  mockRole?: string;
  nodeMockOutput?: JsonObject;
  tools?: ReadonlyArray<ModelToolDefinition>;
  toolHistory?: ReadonlyArray<ModelToolRound>;
  signal?: AbortSignal;
}

export interface ModelToolRound {
  toolCalls: ReadonlyArray<ModelToolCall>;
  toolResults: ReadonlyArray<ModelToolResult>;
}

export interface ModelResponse {
  content: string;
  usage?: TokenUsage;
  toolCalls?: ReadonlyArray<ModelToolCall>;
  finishReason?: string;
}

export interface ModelProvider {
  readonly id: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export class ModelProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ModelProviderError';
  }
}

export type MockModelHandler = (request: ModelRequest) => ModelResponse | Promise<ModelResponse>;

export class MockModelProvider implements ModelProvider {
  readonly id = 'mock';

  constructor(private readonly handler: MockModelHandler = defaultMockHandler) {}

  complete(request: ModelRequest): Promise<ModelResponse> {
    return Promise.resolve(this.handler(request));
  }
}

export class ModelProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  constructor(
    providers: ModelProvider[] = [],
    private readonly defaultProviderId = 'mock',
  ) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: ModelProvider): this {
    if (this.providers.has(provider.id))
      throw new ModelProviderError(`Provider 已注册：${provider.id}`, false);
    this.providers.set(provider.id, provider);
    return this;
  }

  get(id: string): ModelProvider | undefined {
    return this.providers.get(id);
  }

  resolve(providerId: string | undefined, model: string): ModelProvider {
    const inferredId = providerId ?? model.split('/')[0] ?? model;
    const provider = this.providers.get(inferredId) ?? this.providers.get(this.defaultProviderId);
    if (!provider)
      throw new ModelProviderError(`找不到 Model Provider：${providerId ?? model}`, false);
    return provider;
  }

  list(): ModelProvider[] {
    return [...this.providers.values()];
  }
}

export function createDefaultModelProviderRegistry(
  env: NodeJS.ProcessEnv = process.env,
): ModelProviderRegistry {
  // 测试必须保持确定性，不能因为本地 .env 配置了真实 Provider 而访问外部 API。
  const configured = env.NODE_ENV === 'test' ? undefined : createOpenAICompatibleProviderFromEnv(env);
  const providers: ModelProvider[] = [
    new MockModelProvider(),
    ...(configured ? [configured.provider] : []),
  ];
  return new ModelProviderRegistry(providers, configured ? configured.provider.id : 'mock');
}

export {
  OpenAICompatibleProvider,
  createOpenAICompatibleProviderFromEnv,
  type OpenAICompatibleProviderOptions,
} from './openai-compatible-provider.js';

function defaultMockHandler(request: ModelRequest): ModelResponse {
  const input = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
  const role = request.mockRole;
  if (role === 'requirement')
    return { content: JSON.stringify({ requirement: input, acceptanceCriteria: ['测试首次失败', '修复后通过'] }) };
  if (role === 'plan')
    return { content: JSON.stringify({ tasks: ['frontend', 'backend', 'test', 'review'] }) };
  if (role === 'frontend') return { content: JSON.stringify({ completed: true, area: 'frontend' }) };
  if (role === 'backend') return { content: JSON.stringify({ completed: true, area: 'backend' }) };
  if (role === 'test') {
    const previousFix = typeof request.input === 'object' && request.input !== null && !Array.isArray(request.input)
      ? request.input.fixed
      : undefined;
    const fixed = previousFix === true || (typeof previousFix === 'object' && previousFix !== null && !Array.isArray(previousFix));
    return {
      content: JSON.stringify({ passed: fixed, attempt: fixed ? 2 : 1 }),
    };
  }
  if (request.nodeMockOutput) return { content: JSON.stringify(request.nodeMockOutput) };
  if (role === 'review') {
    const input = request.input;
    const test = typeof input === 'object' && input !== null && !Array.isArray(input) &&
      typeof input.test === 'object' && input.test !== null && !Array.isArray(input.test)
      ? input.test
      : undefined;
    return {
      content: JSON.stringify({
        passed: typeof test === 'object' && test !== null && !Array.isArray(test) && test.passed === true,
      }),
    };
  }
  if (role === 'fix') return { content: JSON.stringify({ fixed: true, passed: true }) };
  if (request.outputFormat === 'json') return { content: JSON.stringify({ response: input }) };
  return { content: `Mock response: ${input}` };
}
