import type { AgentNode, JsonObject } from '@ai-workflow/shared-types';
import {
  agentConfigFromNode,
  AgentExecutionError,
  type AgentExecutionContext,
  type AgentExecutor,
  type AgentOutput,
} from './agent.js';
import {
  ModelProviderRegistry,
  createDefaultModelProviderRegistry,
  type ModelProviderRegistry as ProviderRegistry,
} from './model-provider.js';

export interface AgentExecutorOptions {
  providers?: ProviderRegistry;
  timeoutMs?: number;
}

export class ProviderAgentExecutor implements AgentExecutor {
  private readonly providers: ProviderRegistry;

  constructor(options: AgentExecutorOptions = {}) {
    this.providers = options.providers ?? createDefaultModelProviderRegistry();
  }

  async execute(context: AgentExecutionContext): Promise<AgentOutput> {
    const config = agentConfigFromNode(context.node);
    const startedAt = Date.now();
    const timeoutMs = config.timeout;
    try {
      const provider = this.providers.resolve(config.provider, config.model);
      const response = await withTimeout(
        provider.complete({
          model: config.model,
          systemPrompt: config.systemPrompt,
          input: context.input,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          signal: context.signal,
        }),
        timeoutMs,
      );
      const output = parseOutput(response.content, config.outputSchema);
      return {
        output,
        rawText: response.content,
        usage: response.usage,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof AgentExecutionError) throw error;
      throw new AgentExecutionError('LLM_ERROR', `Agent ${config.id} 调用模型失败`, true, {
        cause: error,
      });
    }
  }
}

export function createDefaultAgentExecutor(
  options: AgentExecutorOptions = {},
): ProviderAgentExecutor {
  return new ProviderAgentExecutor(options);
}

function parseOutput(content: string, schema: JsonObject | undefined): JsonObject {
  if (!schema) return { response: content };
  try {
    const value: unknown = JSON.parse(content);
    if (!isObject(value)) throw new Error('输出不是 JSON 对象');
    return value;
  } catch (error) {
    throw new AgentExecutionError('PARSING_ERROR', 'Agent 输出无法解析为结构化 JSON', false, {
      cause: error,
    });
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (timeoutMs === undefined) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AgentExecutionError('TIMEOUT', `Agent 执行超时（${timeoutMs}ms）`, true)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isAgentNode(value: unknown): value is AgentNode {
  return isObject(value) && value.type === 'agent';
}

export { ModelProviderRegistry };
