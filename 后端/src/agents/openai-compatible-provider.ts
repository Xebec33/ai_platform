import type { JsonObject } from '@ai-workflow/shared-types';
import {
  ModelProviderError,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from './model-provider.js';

export interface OpenAICompatibleProviderOptions {
  id?: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  organization?: string;
  project?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: Array<{
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  error?: { message?: unknown; type?: unknown; code?: unknown };
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string | undefined;
  private readonly organization: string | undefined;
  private readonly project: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.apiKey.trim()) throw new ModelProviderError('API Key 不能为空', false);
    this.id = options.id?.trim() || 'openai-compatible';
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? 'https://api.openai.com/v1');
    this.defaultModel = options.defaultModel?.trim() || undefined;
    this.organization = options.organization?.trim() || undefined;
    this.project = options.project?.trim() || undefined;
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 60_000, 'timeoutMs');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    request.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await this.fetchImpl(this.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(toChatCompletionRequest(request, this.defaultModel)),
        signal: controller.signal,
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new ModelProviderError(
          extractErrorMessage(payload, `Provider 请求失败（HTTP ${response.status}）`),
          response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
        );
      }
      return toModelResponse(payload);
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      if (request.signal?.aborted)
        throw new ModelProviderError('Provider 请求已取消', false, { cause: error });
      if (controller.signal.aborted)
        throw new ModelProviderError(`Provider 请求超时（${this.timeoutMs}ms）`, true, { cause: error });
      throw new ModelProviderError('Provider 网络请求失败', true, { cause: error });
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...(this.organization ? { 'OpenAI-Organization': this.organization } : {}),
      ...(this.project ? { 'OpenAI-Project': this.project } : {}),
    };
  }
}

export interface OpenAICompatibleProviderConfig {
  providerId: string;
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export function createOpenAICompatibleProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { provider: OpenAICompatibleProvider; model: string } | undefined {
  const apiKey = env.OPENAI_API_KEY?.trim() || env.DEEPSEEK_API_KEY?.trim();
  const enabled = (env.MODEL_PROVIDER ?? '').trim().toLowerCase();
  if (enabled !== 'openai' && enabled !== 'deepseek' && enabled !== 'openai-compatible')
    return undefined;
  if (!apiKey)
    throw new Error('启用 OpenAI-compatible Provider 时必须配置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY');
  const baseUrl = env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const model = env.OPENAI_MODEL?.trim() || 'deepseek-chat';
  return {
    provider: new OpenAICompatibleProvider({
      id: env.OPENAI_PROVIDER_ID?.trim() || 'openai-compatible',
      apiKey,
      baseUrl,
      organization: env.OPENAI_ORGANIZATION,
      project: env.OPENAI_PROJECT,
      timeoutMs: readPositiveInteger(env.OPENAI_TIMEOUT_MS, 60_000),
      defaultModel: model,
    }),
    model,
  };
}

function toChatCompletionRequest(request: ModelRequest, defaultModel?: string): JsonObject {
  const messages: JsonObject[] = [
    { role: 'system', content: request.systemPrompt },
    { role: 'user', content: toInputText(request.input) },
  ];
  for (const round of request.toolHistory ?? []) {
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: round.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      })),
    });
    messages.push(
      ...round.toolResults.map((result) => ({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: JSON.stringify(result.ok ? result.output ?? {} : { error: result.error }),
      })),
    );
  }
  return {
    model: defaultModel ?? request.model,
    messages,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    ...(shouldRequestJsonObject(request)
      ? { response_format: { type: 'json_object' } }
      : {}),
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }
      : {}),
  };
}

async function parseJsonResponse(response: Response): Promise<ChatCompletionResponse> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as ChatCompletionResponse;
  } catch (error) {
    throw new ModelProviderError('Provider 返回了无效 JSON', response.status >= 500, { cause: error });
  }
}

function toModelResponse(payload: ChatCompletionResponse): ModelResponse {
  const message = payload.choices?.[0]?.message;
  if (!message) throw new ModelProviderError('Provider 响应缺少 choices[0].message', true);
  const content = typeof message.content === 'string' ? message.content : '';
  const toolCalls = (message.tool_calls ?? []).flatMap((call, index) => {
    const name = call.function?.name;
    if (typeof name !== 'string' || !name.trim()) return [];
    return [
      {
        id: typeof call.id === 'string' && call.id ? call.id : `tool-call-${index + 1}`,
        name,
        input: parseToolArguments(call.function?.arguments),
      },
    ];
  });
  return {
    content,
    ...(toolCalls.length ? { toolCalls } : {}),
    usage: payload.usage
      ? {
          promptTokens: asNumber(payload.usage.prompt_tokens),
          completionTokens: asNumber(payload.usage.completion_tokens),
          totalTokens: asNumber(payload.usage.total_tokens),
        }
      : undefined,
  };
}

function parseToolArguments(value: unknown): JsonObject {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function extractErrorMessage(payload: ChatCompletionResponse, fallback: string): string {
  return typeof payload.error?.message === 'string' ? payload.error.message : fallback;
}

function shouldRequestJsonObject(request: ModelRequest): boolean {
  if (request.outputFormat !== 'json') return false;
  const properties = request.outputSchema?.properties;
  return isObject(properties) && Object.keys(properties).length > 0;
}

function toInputText(input: ModelRequest['input']): string {
  return typeof input === 'string' ? input : JSON.stringify(input);
}

function normalizeBaseUrl(value: string): string {
  const baseUrl = value.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new ModelProviderError('baseUrl 不能为空', false);
  return baseUrl;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new ModelProviderError(`${name} 必须是正整数`, false);
  return value;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return positiveInteger(parsed, 'OPENAI_TIMEOUT_MS');
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
