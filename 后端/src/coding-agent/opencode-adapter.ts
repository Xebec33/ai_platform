import { spawn } from 'node:child_process';
import type { JsonObject } from '@ai-workflow/shared-types';
import {
  CODING_AGENT_CAPABILITIES,
  CodingAgentError,
  type CodingAgentAdapter,
  type CodingAgentRequest,
  type CodingAgentResult,
} from './types.js';

export interface OpenCodeAdapterOptions {
  executable?: string;
  defaultModel?: string;
  defaultAgent?: string;
  maxOutputBytes?: number;
}

export class OpenCodeAdapter implements CodingAgentAdapter {
  readonly id = 'opencode';
  private readonly executable: string;
  private readonly maxOutputBytes: number;
  private readonly defaultModel: string | undefined;
  private readonly defaultAgent: string | undefined;

  constructor(options: OpenCodeAdapterOptions = {}) {
    this.executable = options.executable ?? 'opencode';
    this.maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
    this.defaultModel = options.defaultModel;
    this.defaultAgent = options.defaultAgent;
    if (!this.executable.trim()) throw new CodingAgentError('INVALID_REQUEST', 'OpenCode executable 不能为空');
    if (!Number.isInteger(this.maxOutputBytes) || this.maxOutputBytes <= 0)
      throw new CodingAgentError('INVALID_REQUEST', 'maxOutputBytes 必须是正整数');
  }

  async execute(request: CodingAgentRequest): Promise<CodingAgentResult> {
    validateRequest(request);
    const args = ['run', '--format', 'json', '--dir', request.workspaceRoot];
    const model = request.model ?? this.defaultModel;
    const agent = request.agent ?? this.defaultAgent;
    if (model) args.push('--model', model);
    if (agent) args.push('--agent', agent);
    args.push(request.prompt);

    const result = await runProcess(this.executable, args, request, this.maxOutputBytes);
    if (result.error) throw result.error;
    if (result.timedOut)
      throw new CodingAgentError('TIMEOUT', `OpenCode 执行超时（${request.timeoutMs ?? 30_000}ms）`, true);
    if (result.cancelled) throw new CodingAgentError('CANCELLED', 'Coding Agent 执行已取消');
    if (result.exitCode !== 0)
      throw new CodingAgentError('AGENT_FAILED', `OpenCode 执行失败（exitCode=${result.exitCode}）`, true, {
        cause: result.stderr,
      });

    return {
      summary: extractSummary(result.stdout),
      events: parseJsonEvents(result.stdout),
      rawOutput: result.stdout,
      exitCode: result.exitCode,
      capabilities: CODING_AGENT_CAPABILITIES,
    };
  }
}

function validateRequest(request: CodingAgentRequest): void {
  if (!request.prompt.trim()) throw new CodingAgentError('INVALID_REQUEST', 'Coding Agent prompt 不能为空');
  if (!request.workspaceRoot.trim())
    throw new CodingAgentError('INVALID_REQUEST', 'Coding Agent workspaceRoot 不能为空');
  if (request.timeoutMs !== undefined && (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0))
    throw new CodingAgentError('INVALID_REQUEST', 'timeoutMs 必须是正整数');
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  error?: CodingAgentError;
}

function runProcess(
  executable: string,
  args: readonly string[],
  request: CodingAgentRequest,
  maxOutputBytes: number,
): Promise<ProcessResult> {
  const timeoutMs = request.timeoutMs ?? 30_000;
  return new Promise((resolve) => {
    const child = spawn(executable, [...args], {
      cwd: request.workspaceRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    const onAbort = () => {
      cancelled = true;
      child.kill('SIGTERM');
    };
    if (request.signal?.aborted) onAbort();
    else request.signal?.addEventListener('abort', onAbort, { once: true });

    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') <= maxOutputBytes) return next;
      child.kill('SIGTERM');
      return Buffer.from(next, 'utf8').subarray(0, maxOutputBytes).toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      resolve({
        stdout,
        stderr,
        exitCode: null,
        timedOut,
        cancelled,
        error: new CodingAgentError(
          isMissingExecutableError(error) ? 'COMMAND_NOT_FOUND' : 'PROCESS_ERROR',
          `无法启动 Coding Agent：${executable}`,
          true,
          { cause: error },
        ),
      });
    });
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, exitCode, timedOut, cancelled });
    });
  });
}

function parseJsonEvents(output: string): JsonObject[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value: unknown = JSON.parse(line);
        return isObject(value) ? [value] : [];
      } catch {
        return [];
      }
    });
}

function extractSummary(output: string): string {
  const events = parseJsonEvents(output);
  const text = events
    .map((event) => event.part)
    .filter(isObject)
    .map((part) => part.text)
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .trim();
  return text || output.trim();
}

function isMissingExecutableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
