import type { AgentNode, JsonObject, JsonValue } from '@ai-workflow/shared-types';
import { ToolError } from '../tools/types.js';
import type { ModelResponse, ModelToolResult, ModelToolRound } from './model-provider.js';
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
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxToolRounds?: number;
}

export class ProviderAgentExecutor implements AgentExecutor {
  private readonly providers: ProviderRegistry;
  private readonly maxToolRounds: number;

  constructor(options: AgentExecutorOptions = {}) {
    this.providers = options.providers ?? createDefaultModelProviderRegistry(options.environment);
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
      const tools = config.useTools ? context.toolRegistry : undefined;
      let toolHistory: ModelToolRound[] = [];
      let toolCalls = 0;
      const complete = (extraPrompt = '') =>
        withTimeout(
          provider.complete({
            model: config.model,
            systemPrompt: systemPromptFor(config) + extraPrompt,
            input: context.input,
            outputFormat: config.outputFormat,
            outputSchema: config.outputSchema,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            mockRole: config.mockRole,
            nodeMockOutput: objectValue(context.node.config.mockOutput),
            tools: tools?.list(),
            toolHistory,
            signal: execution.signal,
          }),
          timeoutMs,
          execution.controller,
          execution.signal,
        );
      let response = await complete();
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
        toolHistory = [...toolHistory, { toolCalls: [...response.toolCalls], toolResults: results }];
        response = await complete();
      }
      const parsed = await parseWithRetry(
        response,
        () => complete(REPARSE_HINT),
        (content) => parseOutput(content, config.outputSchema, config.outputFormat),
        config.maxTokens,
      );
      return {
        output: parsed.output,
        rawText: parsed.response.content,
        usage: parsed.response.usage,
        latencyMs: Date.now() - startedAt,
        toolCalls,
      };
    } catch (error) {
      if (error instanceof AgentExecutionError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new AgentExecutionError(
        'LLM_ERROR',
        `Agent ${config.id} 调用模型失败：${detail}`,
        true,
        { cause: error },
      );
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

const REPARSE_HINT =
  '\n\n注意：你上一次的输出无法解析为 JSON，请重新输出，务必只输出符合上述格式要求的合法 JSON，不要包含任何其他内容。';

async function parseWithRetry(
  initial: ModelResponse,
  reask: () => Promise<ModelResponse>,
  parse: (content: string) => JsonObject,
  maxTokens?: number,
): Promise<{ output: JsonObject; response: ModelResponse }> {
  assertNotTruncated(initial, maxTokens);
  try {
    return { output: parse(initial.content), response: initial };
  } catch (error) {
    if (!(error instanceof AgentExecutionError) || error.code !== 'PARSING_ERROR') throw error;
  }
  const response = await reask();
  assertNotTruncated(response, maxTokens);
  try {
    return { output: parse(response.content), response };
  } catch (error) {
    throw detailedParsingError(response.content, error);
  }
}

function assertNotTruncated(response: ModelResponse, maxTokens?: number): void {
  if (response.finishReason !== 'length') return;
  const cap = maxTokens !== undefined ? `（maxTokens=${maxTokens}）` : '';
  const usage = response.usage?.completionTokens !== undefined
    ? `，本次输出共消耗 ${response.usage.completionTokens} tokens`
    : '';
  throw new AgentExecutionError(
    'LLM_OUTPUT_TRUNCATED',
    `模型输出被截断${cap}${usage}：推理型模型会先消耗思考 token，预算不足时正文为空或被拦腰截断。请调大该 Agent 节点的 maxTokens。`,
    false,
  );
}

function detailedParsingError(content: string, cause: unknown): AgentExecutionError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const text = content.trim();
  const preview = text.length
    ? `原始输出（${content.length} 字符）：${text.slice(0, 300)}`
    : '原始输出为空';
  return new AgentExecutionError(
    'PARSING_ERROR',
    `Agent 输出无法解析为结构化 JSON（原因：${reason}；${preview}）`,
    false,
    { cause },
  );
}

function parseOutput(
  content: string,
  schema: JsonObject | undefined,
  outputFormat: 'text' | 'json' | undefined,
): JsonObject {
  if (outputFormat !== 'json' && !schema) return { text: content };
  try {
    const value = parseJsonContent(content);
    if (isObject(value)) return value;
    if (allowsNonObjectOutput(schema)) return { response: value as JsonValue };
    throw new Error('输出不是 JSON 对象');
  } catch (error) {
    throw new AgentExecutionError('PARSING_ERROR', 'Agent 输出无法解析为结构化 JSON', false, {
      cause: error,
    });
  }
}

function parseJsonContent(content: string): unknown {
  const text = content.trim();
  const candidates = [text];
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const embedded = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (embedded?.[1]) candidates.push(embedded[1]);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('输出不是有效 JSON');
}

function allowsNonObjectOutput(schema: JsonObject | undefined): boolean {
  if (!schema || schema.type !== 'object') return true;
  const properties = schema.properties;
  return !isObject(properties) || Object.keys(properties).length === 0;
}

function systemPromptFor(config: {
  systemPrompt: string;
  outputFormat?: 'text' | 'json';
  outputSchema?: JsonObject;
}): string {
  if (config.outputFormat !== 'json') return config.systemPrompt;
  const properties = isObject(config.outputSchema?.properties) ? config.outputSchema.properties : {};
  const keys = Object.keys(properties);
  const target = keys.length > 0
    ? 'JSON 对象，字段为：' + keys.map((key) => {
        const description = isObject(properties[key]) && typeof (properties[key] as JsonObject).description === 'string'
          ? ((properties[key] as JsonObject).description as string).trim()
          : '';
        return description ? `${key}（${description}）` : key;
      }).join('、')
    : '合法 JSON 值';
  return `${config.systemPrompt}\n\n输出格式要求：只输出${target}，不要输出 Markdown 代码块、解释文字或其他前后缀。`;
}

function objectValue(value: JsonValue | undefined): JsonObject | undefined {
  return isObject(value) ? value : undefined;
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
