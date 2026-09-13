import type { JsonObject } from '@ai-workflow/shared-types';
import { runWorkspaceCommand } from '../shell/index.js';
import {
  optionalPositiveInteger,
  requiredString,
  toolFailure,
  type Tool,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from '../types.js';

const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

export class GitTool implements Tool {
  readonly name = 'git';
  readonly description = '在 workspace 内执行受限的 Git 状态、差异、分支和提交操作';
  readonly inputSchema: JsonObject = {
    type: 'object',
    required: ['operation'],
    properties: {
      operation: { type: 'string', enum: ['status', 'diff', 'branch', 'checkout', 'commit'] },
      branch: { type: 'string' },
      message: { type: 'string' },
      paths: { type: 'array', items: { type: 'string' } },
      timeoutMs: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
  };

  async execute(input: JsonObject, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      const operation = requiredString(input, 'operation');
      const args = this.argsFor(operation, input);
      const timeoutMs = optionalPositiveInteger(input, 'timeoutMs') ?? 30_000;
      const result = await runWorkspaceCommand('git', args, context, { timeoutMs });
      const output: JsonObject = {
        operation,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
      };
      if (result.exitCode !== 0 || result.timedOut)
        return {
          ok: false,
          output,
          error: {
            code: result.timedOut ? 'GIT_TIMEOUT' : 'GIT_ERROR',
            message: result.timedOut ? 'Git 操作超时' : 'Git 操作失败',
          },
        };
      return { ok: true, output };
    } catch (error) {
      return toolFailure(errorCode(error, 'GIT_ERROR'), error);
    }
  }

  private argsFor(operation: string, input: JsonObject): string[] {
    switch (operation) {
      case 'status':
        return ['status', '--short', '--branch'];
      case 'diff':
        return ['diff', '--', ...pathsOf(input)];
      case 'branch':
        return ['branch', '--show-current'];
      case 'checkout': {
        const branch = requiredString(input, 'branch');
        if (!BRANCH_PATTERN.test(branch) || branch.startsWith('-'))
          throw new Error('branch 名称不合法');
        return ['checkout', branch];
      }
      case 'commit': {
        const message = requiredString(input, 'message');
        return ['commit', '-m', message];
      }
      default:
        throw new Error('不支持的 Git operation：' + operation);
    }
  }
}

function pathsOf(input: JsonObject): string[] {
  const value = input.paths;
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.startsWith('-'))
  )
    throw new Error('paths 必须是字符串数组且不能包含选项');
  return value.filter((item): item is string => typeof item === 'string');
}

function errorCode(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : fallback;
}
