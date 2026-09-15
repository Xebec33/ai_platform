import type { AgentNode, JsonObject, JsonValue } from '@ai-workflow/shared-types';
import type { ToolRegistry } from '../tools/index.js';

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  model: string;
  provider?: string;
  systemPrompt: string;
  outputFormat?: 'text' | 'json';
  mockRole?: string;
  agent?: string;
  executorId?: string;
  inputMapping?: JsonObject;
  outputSchema?: JsonObject;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  outputKey?: string;
  useTools?: boolean;
}

export interface AgentInput {
  input: JsonValue;
  variables: JsonObject;
  nodeOutputs: Readonly<Record<string, JsonObject>>;
  signal?: AbortSignal;
  toolRegistry?: ToolRegistry;
  workspaceRoot?: string;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AgentOutput {
  output: JsonObject;
  rawText?: string;
  usage?: TokenUsage;
  latencyMs?: number;
  toolCalls?: number;
}

export interface AgentExecutionContext extends AgentInput {
  node: AgentNode;
}

export interface AgentExecutor {
  execute(context: AgentExecutionContext): Promise<AgentOutput>;
}

export type AgentExecutorLike =
  AgentExecutor | ((context: AgentExecutionContext) => Promise<AgentOutput>);

export type AgentErrorCode =
  | 'LLM_ERROR'
  | 'PARSING_ERROR'
  | 'TOOL_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'BUSINESS_ERROR'
  | 'INVALID_OUTPUT';

export class AgentExecutionError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly retryable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AgentExecutionError';
  }
}

export function agentConfigFromNode(node: AgentNode): AgentConfig {
  return {
    id: node.id,
    name: node.name,
    model: node.config.model,
    provider: asString(node.config.provider),
    systemPrompt: node.config.systemPrompt,
    outputFormat: node.config.outputFormat === 'json' ? 'json' : node.config.outputFormat === 'text' ? 'text' : undefined,
    mockRole: asString(node.config.mockRole),
    agent: asString(node.config.agent),
    executorId: asString(node.config.executorId),
    inputMapping: node.input,
    outputSchema: asObject(node.config.outputSchema),
    temperature: asNumber(node.config.temperature),
    maxTokens: asNumber(node.config.maxTokens),
    timeout: asNumber(node.config.timeout),
    outputKey: node.outputKey ?? node.config.outputKey,
    useTools: node.config.useTools === true,
  };
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asObject(value: JsonValue | undefined): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}
