import type { JsonObject, JsonValue } from '@ai-workflow/shared-types';
import type { TokenUsage } from './agent.js';

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
  tools?: ReadonlyArray<ModelToolDefinition>;
  toolResults?: ReadonlyArray<ModelToolResult>;
  signal?: AbortSignal;
}

export interface ModelResponse {
  content: string;
  usage?: TokenUsage;
  toolCalls?: ReadonlyArray<ModelToolCall>;
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

export function createDefaultModelProviderRegistry(): ModelProviderRegistry {
  return new ModelProviderRegistry([new MockModelProvider()]);
}

function defaultMockHandler(request: ModelRequest): ModelResponse {
  const input = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
  return { content: `Mock response: ${input}` };
}
