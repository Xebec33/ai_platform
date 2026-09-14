import type { JsonObject, JsonValue } from '@ai-workflow/shared-types';
import {
  AgentExecutionError,
  type AgentExecutionContext,
  type AgentExecutor,
  type AgentOutput,
} from '../agents/agent.js';
import {
  CodingAgentError,
  type CodingAgentAdapter,
  type CodingAgentResult,
} from './types.js';

export interface CodingAgentExecutorOptions {
  adapter: CodingAgentAdapter;
  promptBuilder?: (context: AgentExecutionContext) => string;
}

export class CodingAgentExecutor implements AgentExecutor {
  private readonly promptBuilder: (context: AgentExecutionContext) => string;

  constructor(private readonly options: CodingAgentExecutorOptions) {
    this.promptBuilder = options.promptBuilder ?? defaultPromptBuilder;
  }

  async execute(context: AgentExecutionContext): Promise<AgentOutput> {
    if (!context.workspaceRoot)
      throw new AgentExecutionError(
        'BUSINESS_ERROR',
        'Coding Agent 必须配置 workspaceRoot',
        false,
      );
    try {
      const result = await this.options.adapter.execute({
        prompt: this.promptBuilder(context),
        workspaceRoot: context.workspaceRoot,
        model: asString(context.node.config.model),
        agent: asString(context.node.config.agent),
        timeoutMs: asPositiveInteger(context.node.config.timeout),
        signal: context.signal,
      });
      return toAgentOutput(result);
    } catch (error) {
      if (error instanceof CodingAgentError)
        throw new AgentExecutionError(
          mapErrorCode(error.code),
          error.message,
          error.retryable,
          { cause: error },
        );
      throw new AgentExecutionError('LLM_ERROR', 'Coding Agent 执行失败', true, { cause: error });
    }
  }
}

function defaultPromptBuilder(context: AgentExecutionContext): string {
  const input = stringifyInput(context.input);
  return [
    context.node.config.systemPrompt,
    '请在当前 workspace 中完成以下任务。需要读取代码、修改文件、执行测试并返回结果。',
    `任务输入：${input}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function toAgentOutput(result: CodingAgentResult): AgentOutput {
  const output: JsonObject = {
    summary: result.summary,
    events: result.events,
    rawOutput: result.rawOutput,
    exitCode: result.exitCode,
    capabilities: [...result.capabilities],
  };
  return { output, rawText: result.summary };
}

function stringifyInput(input: JsonValue): string {
  return typeof input === 'string' ? input : JSON.stringify(input);
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asPositiveInteger(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function mapErrorCode(code: CodingAgentError['code']): AgentExecutionError['code'] {
  switch (code) {
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'INVALID_REQUEST':
      return 'BUSINESS_ERROR';
    case 'COMMAND_NOT_FOUND':
    case 'PROCESS_ERROR':
    case 'AGENT_FAILED':
      return 'LLM_ERROR';
  }
}
