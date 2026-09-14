import type { JsonObject } from '@ai-workflow/shared-types';
import type { SandboxExecutor } from '../sandbox/index.js';
import {
  optionalPositiveInteger,
  toolFailure,
  type Tool,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from './types.js';

export class SandboxTool implements Tool {
  readonly name = 'sandbox';
  readonly description = '在 Docker Sandbox 中执行 workspace 内的命令';
  readonly inputSchema: JsonObject = {
    type: 'object',
    required: ['command'],
    properties: {
      command: { type: 'array', items: { type: 'string' }, minItems: 1 },
      timeoutMs: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
  };

  constructor(private readonly executor: SandboxExecutor) {}

  async execute(input: JsonObject, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      const rawCommand = input.command;
      if (!Array.isArray(rawCommand) || rawCommand.some((item) => typeof item !== 'string'))
        return toolFailure('INVALID_INPUT', 'Sandbox command 必须是字符串数组');
      const command = rawCommand as string[];
      if (command.length === 0 || !command[0]?.trim())
        return toolFailure('INVALID_INPUT', 'Sandbox command 不能为空');
      const result = await this.executor.execute({
        workspaceRoot: context.workspaceRoot,
        command,
        timeoutMs: optionalPositiveInteger(input, 'timeoutMs'),
        signal: context.signal,
      });
      const output: JsonObject = {
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        outputLimitExceeded: result.outputLimitExceeded,
      };
      if (!result.ok)
        return {
          ok: false,
          output,
          error: {
            code: result.errorCode ?? 'SANDBOX_ERROR',
            message: result.errorMessage ?? 'Sandbox 执行失败',
          },
        };
      return { ok: true, output };
    } catch (error) {
      return toolFailure('SANDBOX_ERROR', error);
    }
  }
}
