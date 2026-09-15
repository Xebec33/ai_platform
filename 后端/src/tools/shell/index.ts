import { spawn } from 'node:child_process';
import path from 'node:path';
import type { JsonObject } from '@ai-workflow/shared-types';
import { ensureWorkspaceDirectory } from '../workspace.js';
import {
  optionalPositiveInteger,
  optionalString,
  requiredString,
  toolFailure,
  type Tool,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from '../types.js';

export interface WorkspaceCommandOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface WorkspaceCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimitExceeded: boolean;
}

const DEFAULT_ALLOWED_COMMANDS = [
  'echo', 'printf', 'pwd',
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'date',
  'mkdir', 'touch', 'cp', 'mv', 'sed',
];

export class ShellTool implements Tool {
  readonly name = 'shell';
  readonly description = '在 workspace 内执行受限的单条命令';
  readonly inputSchema: JsonObject = {
    type: 'object',
    required: ['command'],
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string' },
      timeoutMs: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
  };

  private readonly allowedCommands: ReadonlySet<string>;

  constructor(
    private readonly options: {
      allowedCommands?: ReadonlyArray<string>;
      timeoutMs?: number;
      maxOutputBytes?: number;
    } = {},
  ) {
    this.allowedCommands = new Set(options.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS);
  }

  async execute(input: JsonObject, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      const command = requiredString(input, 'command');
      const cwd = await ensureWorkspaceDirectory(
        context.workspaceRoot,
        optionalString(input, 'cwd'),
      );
      const timeoutMs =
        optionalPositiveInteger(input, 'timeoutMs') ?? this.options.timeoutMs ?? 30_000;
      const tokens = parseCommand(command);
      const executable = tokens[0];
      if (!executable) return toolFailure('INVALID_INPUT', 'command 不能为空');
      const commandName = path.basename(executable);
      if (executable !== commandName || !this.allowedCommands.has(commandName))
        return toolFailure('COMMAND_NOT_ALLOWED', `不允许执行命令：${commandName}`);
      validateSafeCommandArguments(commandName, tokens.slice(1));
      const result = await runWorkspaceCommand(
        executable,
        tokens.slice(1),
        { ...context, workspaceRoot: context.workspaceRoot },
        { cwd: cwd.path, timeoutMs, maxOutputBytes: this.options.maxOutputBytes },
      );
      const output: JsonObject = {
        command,
        cwd: cwd.relativePath,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        outputLimitExceeded: result.outputLimitExceeded,
      };
      if (result.exitCode !== 0 || result.timedOut || result.outputLimitExceeded)
        return {
          ok: false,
          output,
          error: {
            code: result.timedOut ? 'SHELL_TIMEOUT' : 'SHELL_EXIT',
            message: result.timedOut ? `命令执行超时（${timeoutMs}ms）` : '命令执行失败',
          },
        };
      return { ok: true, output };
    } catch (error) {
      return toolFailure(errorCode(error, 'SHELL_ERROR'), error);
    }
  }
}

export async function runWorkspaceCommand(
  executable: string,
  args: ReadonlyArray<string>,
  context: ToolExecutionContext,
  options: WorkspaceCommandOptions & { cwd?: string } = {},
): Promise<WorkspaceCommandResult> {
  const cwd = options.cwd ?? context.workspaceRoot;
  const maxOutputBytes = options.maxOutputBytes ?? 256 * 1024;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd,
      shell: false,
      env: mergeProcessEnv(options.env),
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    const onAbort = () => child.kill('SIGTERM');
    context.signal?.addEventListener('abort', onAbort, { once: true });
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') <= maxOutputBytes) return next;
      outputLimitExceeded = true;
      return Buffer.from(next, 'utf8').subarray(0, maxOutputBytes).toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
      if (outputLimitExceeded) child.kill('SIGTERM');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
      if (outputLimitExceeded) child.kill('SIGTERM');
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode, signal, stdout, stderr, timedOut, outputLimitExceeded });
    });
  });
}

function parseCommand(command: string): string[] {
  if (/[;&|<>`$()]/.test(command)) throw new Error('command 不允许包含 shell 操作符');
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = pattern.exec(command))) {
    if (command.slice(consumed, match.index).trim()) throw new Error('command 参数无法解析');
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
    consumed = pattern.lastIndex;
  }
  if (command.slice(consumed).trim()) throw new Error('command 参数无法解析');
  return tokens;
}

function mergeProcessEnv(overrides: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function validateSafeCommandArguments(command: string, args: ReadonlyArray<string>): void {
  if (command === 'pwd' && args.length > 0) throw new Error('pwd 不接受命令参数');
}

function errorCode(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : fallback;
}
