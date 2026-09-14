import path from 'node:path';
import type { JsonObject } from '@ai-workflow/shared-types';
import { runWorkspaceCommand } from '../shell/index.js';
import { normalizeWorkspaceRoot, resolveWorkspaceCommandPath } from '../workspace.js';
import {
  optionalPositiveInteger,
  requiredString,
  toolFailure,
  ToolError,
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
      operation: { type: 'string', enum: ['status', 'diff', 'branch', 'checkout', 'commit', 'merge'] },
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
      const workspaceRoot = normalizeWorkspaceRoot(context.workspaceRoot);
      const args = await this.argsFor(operation, input, workspaceRoot);
      const timeoutMs = optionalPositiveInteger(input, 'timeoutMs') ?? 30_000;
      const env = gitEnvironment();
      const discovery = await runWorkspaceCommand(
        'git',
        ['rev-parse', '--show-toplevel'],
        context,
        { cwd: workspaceRoot, timeoutMs, env },
      );
      if (discovery.exitCode === 0) {
        const repositoryRoot = normalizeWorkspaceRoot(discovery.stdout.trim());
        if (!isWithinWorkspace(workspaceRoot, repositoryRoot))
          throw new ToolError('WORKSPACE_BOUNDARY', 'Git 仓库根目录必须位于 workspaceRoot 内');
      }
      if (operation === 'commit') {
        const staged = await runWorkspaceCommand('git', ['add', '--all'], context, {
          cwd: workspaceRoot,
          timeoutMs,
          env,
        });
        if (staged.exitCode !== 0 || staged.timedOut)
          return {
            ok: false,
            output: {
              operation,
              stdout: staged.stdout,
              stderr: staged.stderr,
              exitCode: staged.exitCode,
              signal: staged.signal,
              timedOut: staged.timedOut,
            },
            error: {
              code: staged.timedOut ? 'GIT_TIMEOUT' : 'GIT_ERROR',
              message: staged.timedOut ? 'Git 暂存操作超时' : 'Git 暂存操作失败',
            },
          };
      }
      const result = await runWorkspaceCommand('git', args, context, {
        cwd: workspaceRoot,
        timeoutMs,
        env,
      });
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

  private async argsFor(
    operation: string,
    input: JsonObject,
    workspaceRoot: string,
  ): Promise<string[]> {
    switch (operation) {
      case 'status':
        return ['status', '--short', '--branch'];
      case 'diff':
        return ['diff', '--', ...(await pathsOf(input, workspaceRoot))];
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
      case 'merge': {
        const branch = requiredString(input, 'branch');
        if (!BRANCH_PATTERN.test(branch) || branch.startsWith('-'))
          throw new Error('branch 名称不合法');
        return ['merge', '--no-ff', '--no-edit', branch];
      }
      default:
        throw new Error('不支持的 Git operation：' + operation);
    }
  }
}

async function pathsOf(input: JsonObject, workspaceRoot: string): Promise<string[]> {
  const value = input.paths;
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.startsWith('-'))
  )
    throw new Error('paths 必须是字符串数组且不能包含选项');
  const paths = value.filter((item): item is string => typeof item === 'string');
  return Promise.all(paths.map((item) => resolveWorkspaceCommandPath(workspaceRoot, item)));
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    GIT_DIR: undefined,
    GIT_INDEX_FILE: undefined,
    GIT_WORK_TREE: undefined,
  };
}

function isWithinWorkspace(workspaceRoot: string, value: string): boolean {
  const relative = path.relative(workspaceRoot, value);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function errorCode(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : fallback;
}
