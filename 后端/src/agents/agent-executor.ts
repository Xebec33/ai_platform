import type { AgentNode, JsonObject } from '@ai-workflow/shared-types';
import { ToolError } from '../tools/types.js';
import type { ModelToolResult } from './model-provider.js';
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
  maxToolRounds?: number;
}

export class ProviderAgentExecutor implements AgentExecutor {
  private readonly providers: ProviderRegistry;
  private readonly maxToolRounds: number;

  constructor(options: AgentExecutorOptions = {}) {
    this.providers = options.providers ?? createDefaultModelProviderRegistry();
    this.maxToolRounds = options.maxToolRounds ?? 4;
    if (!Number.isInteger(this.maxToolRounds) || this.maxToolRounds < 0)
      throw new Error('maxToolRounds 必须是非负整数');
  }

  async execute(context: AgentExecutionContext): Promise<AgentOutput> {
    const config = agentConfigFromNode(context.node);
    const startedAt = Date.now();
    const timeoutMs = config.timeout;
    const execution = createChildAbortController(context.signal);
    try {
      const provider = this.providers.resolve(config.provider, config.model);
      const tools = context.toolRegistry;
      let toolResults: ModelToolResult[] = [];
      let toolCalls = 0;
      let response = await withTimeout(
        provider.complete({
          model: config.model,
          systemPrompt: config.systemPrompt,
          input: context.input,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          tools: tools?.list(),
          toolResults,
          signal: execution.signal,
        }),
        timeoutMs,
        execution.controller,
        execution.signal,
      );
      for (let round = 0; response.toolCalls?.length; round += 1) {
        if (!tools || !context.workspaceRoot)
          throw new AgentExecutionError(
            'TOOL_ERROR',
            'Agent 请求调用 Tool，但未配置 Tool Registry 或 workspace',
            false,
          );
        if (round >= this.maxToolRounds)
          throw new AgentExecutionError(
            'TOOL_ERROR',
            `Tool 调用超过最大轮数（${this.maxToolRounds}）`,
            false,
          );
        const results: ModelToolResult[] = [];
        for (const call of response.toolCalls) {
          toolCalls += 1;
          let result;
          try {
            result = await tools.execute(call.name, call.input, {
              workspaceRoot: context.workspaceRoot,
              signal: execution.signal,
            });
          } catch (error) {
            if (error instanceof ToolError) {
              result = {
                ok: false,
                error: { code: error.code, message: error.message },
              };
            } else throw error;
          }
          results.push({
            toolCallId: call.id,
            name: call.name,
            ok: result.ok,
            output: result.output,
            error: result.error,
          });
        }
        toolResults = [...toolResults, ...results];
        response = await withTimeout(
          provider.complete({
            model: config.model,
            systemPrompt: config.systemPrompt,
            input: context.input,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            tools: tools.list(),
            toolResults,
            signal: execution.signal,
          }),
          timeoutMs,
          execution.controller,
          execution.signal,
        );
      }
      const output = parseOutput(response.content, config.outputSchema);
      return {
        output,
        rawText: response.content,
        usage: response.usage,
        latencyMs: Date.now() - startedAt,
        toolCalls,
      };
    } catch (error) {
      if (error instanceof AgentExecutionError) throw error;
      throw new AgentExecutionError('LLM_ERROR', `Agent ${config.id} 调用模型失败`, true, {
        cause: error,
      });
    } finally {
      execution.dispose();
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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  controller: AbortController,
  signal: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => {
    const rejectCancelled = () =>
      reject(new AgentExecutionError('CANCELLED', 'Agent 执行已取消', false));
    if (signal.aborted) {
      rejectCancelled();
      return;
    }
    onAbort = rejectCancelled;
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const waits: Promise<T>[] = [promise, cancellation];
  if (timeoutMs !== undefined) {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AgentExecutionError('TIMEOUT', `Agent 执行超时（${timeoutMs}ms）`, true));
        controller.abort();
      }, timeoutMs);
    });
    waits.push(timeout);
  }
  try {
    return await Promise.race(waits);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function createChildAbortController(parent?: AbortSignal): {
  controller: AbortController;
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (!parent) return { controller, signal: controller.signal, dispose: () => {} };
  const onAbort = () => controller.abort();
  if (parent.aborted) onAbort();
  else parent.addEventListener('abort', onAbort, { once: true });
  return {
    controller,
    signal: controller.signal,
    dispose: () => parent.removeEventListener('abort', onAbort),
  };
}

export function isAgentNode(value: unknown): value is AgentNode {
  return isObject(value) && value.type === 'agent';
}

export { ModelProviderRegistry };
