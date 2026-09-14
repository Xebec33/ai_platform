import type { JsonObject } from '@ai-workflow/shared-types';
import type { SandboxExecutor } from '../sandbox/index.js';
import { CODING_AGENT_CAPABILITIES, CodingAgentError, type CodingAgentAdapter, type CodingAgentRequest, type CodingAgentResult } from './types.js';

export interface DockerCodingAgentAdapterOptions {
  executor: SandboxExecutor;
  executable?: string;
  defaultModel?: string;
  defaultAgent?: string;
  environment?: Readonly<Record<string, string>>;
}

export class DockerCodingAgentAdapter implements CodingAgentAdapter {
  readonly id = 'opencode-docker';
  private readonly executable: string;
  private readonly defaultModel: string | undefined;
  private readonly defaultAgent: string | undefined;
  private readonly environment: Readonly<Record<string, string>>;

  constructor(private readonly options: DockerCodingAgentAdapterOptions) {
    this.executable = options.executable ?? 'opencode';
    this.defaultModel = options.defaultModel;
    this.defaultAgent = options.defaultAgent;
    this.environment = options.environment ?? {};
    if (!this.executable.trim()) throw new CodingAgentError('INVALID_REQUEST', 'Coding Agent executable 不能为空');
  }

  async execute(request: CodingAgentRequest): Promise<CodingAgentResult> {
    if (!request.prompt.trim()) throw new CodingAgentError('INVALID_REQUEST', 'Coding Agent prompt 不能为空');
    if (!request.workspaceRoot.trim()) throw new CodingAgentError('INVALID_REQUEST', 'Coding Agent workspaceRoot 不能为空');
    const args = ['run', '--format', 'json', '--dir', '/workspace'];
    const model = request.model ?? this.defaultModel;
    const agent = request.agent ?? this.defaultAgent;
    if (model) args.push('--model', model);
    if (agent) args.push('--agent', agent);
    args.push(request.prompt);
    const result = await this.options.executor.execute({
      workspaceRoot: request.workspaceRoot,
      command: [this.executable, ...args],
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      environment: this.environment,
    });
    if (result.errorCode === 'CANCELLED' || result.cancelled)
      throw new CodingAgentError('CANCELLED', 'Coding Agent 执行已取消');
    if (result.timedOut) throw new CodingAgentError('TIMEOUT', result.errorMessage ?? 'Coding Agent 执行超时', true);
    if (result.errorCode === 'DOCKER_NOT_FOUND')
      throw new CodingAgentError('COMMAND_NOT_FOUND', result.errorMessage ?? 'Docker 不可用', true);
    if (!result.ok)
      throw new CodingAgentError('AGENT_FAILED', result.errorMessage ?? 'Coding Agent 执行失败', true, {
        cause: result.stderr,
      });
    const events = parseJsonEvents(result.stdout);
    return {
      summary: extractSummary(result.stdout, events),
      events,
      rawOutput: result.stdout,
      exitCode: result.exitCode,
      capabilities: CODING_AGENT_CAPABILITIES,
    };
  }
}

function parseJsonEvents(output: string): JsonObject[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return isObject(value) ? [value as JsonObject] : [];
    } catch {
      return [];
    }
  });
}

function extractSummary(output: string, events: JsonObject[]): string {
  const text = events.map((event) => event.part).filter(isObject).map((part) => part.text)
    .filter((value): value is string => typeof value === 'string').join('\n').trim();
  return text || output.trim();
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
