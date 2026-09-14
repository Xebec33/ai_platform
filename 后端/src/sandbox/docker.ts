import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { SandboxExecutionRequest, SandboxExecutionResult, SandboxExecutor } from './types.js';
import { SandboxError } from './types.js';

export interface DockerSandboxOptions {
  executable?: string;
  image?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  memoryMb?: number;
  cpus?: number;
  pidsLimit?: number;
  allowNetwork?: boolean;
  hostWorkspaceRoot?: string;
  containerWorkspaceRoot?: string;
}

export class DockerSandboxExecutor implements SandboxExecutor {
  private readonly executable: string;
  private readonly image: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly memoryMb: number;
  private readonly cpus: number;
  private readonly pidsLimit: number;
  private readonly allowNetwork: boolean;
  private readonly hostWorkspaceRoot: string | undefined;
  private readonly containerWorkspaceRoot: string;

  constructor(options: DockerSandboxOptions = {}) {
    this.executable = options.executable ?? process.env.DOCKER_BIN ?? 'docker';
    this.image = options.image ?? process.env.SANDBOX_IMAGE ?? 'ai-workflow-sandbox:latest';
    this.timeoutMs = positive(
      options.timeoutMs ?? readInteger('SANDBOX_TIMEOUT_MS', 120_000),
      'timeoutMs',
    );
    this.maxOutputBytes = positive(
      options.maxOutputBytes ?? readInteger('SANDBOX_MAX_OUTPUT_BYTES', 256 * 1024),
      'maxOutputBytes',
    );
    this.memoryMb = positive(
      options.memoryMb ?? readInteger('SANDBOX_MEMORY_MB', 1_024),
      'memoryMb',
    );
    this.cpus = positiveNumber(options.cpus ?? readNumber('SANDBOX_CPUS', 1), 'cpus');
    this.pidsLimit = positive(
      options.pidsLimit ?? readInteger('SANDBOX_PIDS_LIMIT', 256),
      'pidsLimit',
    );
    this.allowNetwork =
      options.allowNetwork ??
      (process.env.NODE_ENV === 'test' ? false : readBoolean('SANDBOX_ALLOW_NETWORK', false));
    this.hostWorkspaceRoot =
      options.hostWorkspaceRoot ?? (process.env.SANDBOX_HOST_WORKSPACE_ROOT?.trim() || undefined);
    this.containerWorkspaceRoot =
      options.containerWorkspaceRoot ??
      (process.env.SANDBOX_CONTAINER_WORKSPACE_ROOT?.trim() || '/workspace');
    if (!this.executable.trim())
      throw new SandboxError('INVALID_REQUEST', 'Docker executable 不能为空');
    if (!this.image.trim()) throw new SandboxError('INVALID_REQUEST', 'Sandbox image 不能为空');
  }

  async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    const workspaceRoot = await normalizeWorkspace(request.workspaceRoot);
    if (!request.command.length || request.command.some((item) => !item.trim()))
      throw new SandboxError('INVALID_REQUEST', 'Sandbox command 必须是非空参数数组');
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
      throw new SandboxError('INVALID_REQUEST', 'timeoutMs 必须是正整数');

    const mountSource = this.mountSource(workspaceRoot);
    const args = this.buildArgs(mountSource, request.command, request.environment);
    return runProcess(
      this.executable,
      args,
      { ...request, workspaceRoot },
      timeoutMs,
      this.maxOutputBytes,
    );
  }

  private mountSource(workspaceRoot: string): string {
    if (!this.hostWorkspaceRoot) return workspaceRoot;
    const relative = path.relative(this.containerWorkspaceRoot, workspaceRoot);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new SandboxError('INVALID_REQUEST', 'workspaceRoot 不在可映射的容器工作区内');
    return path.resolve(this.hostWorkspaceRoot, relative);
  }

  private buildArgs(
    workspaceRoot: string,
    command: ReadonlyArray<string>,
    environment: Readonly<Record<string, string>> | undefined,
  ): string[] {
    const args = [
      'run',
      '--rm',
      '--init',
      '--workdir',
      '/workspace',
      '--mount',
      `type=bind,source=${workspaceRoot},target=/workspace`,
      '--cpus',
      String(this.cpus),
      '--memory',
      `${this.memoryMb}m`,
      '--pids-limit',
      String(this.pidsLimit),
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
    ];
    if (!this.allowNetwork) args.push('--network', 'none');
    for (const [key, value] of Object.entries(environment ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
        throw new SandboxError('INVALID_REQUEST', `环境变量名称不合法：${key}`);
      args.push('--env', `${key}=${value}`);
    }
    args.push(this.image, ...command);
    return args;
  }
}

async function normalizeWorkspace(value: string): Promise<string> {
  if (!value.trim()) throw new SandboxError('INVALID_REQUEST', 'workspaceRoot 不能为空');
  try {
    return await realpath(value);
  } catch (error) {
    throw new SandboxError('INVALID_REQUEST', `workspaceRoot 不存在：${value}`, { cause: error });
  }
}

function runProcess(
  executable: string,
  args: ReadonlyArray<string>,
  request: SandboxExecutionRequest,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<SandboxExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, [...args], {
      cwd: request.workspaceRoot,
      shell: false,
      env: { ...process.env, ...request.environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let outputLimitExceeded = false;
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
      outputLimitExceeded = true;
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
      const missing = isMissingExecutable(error);
      resolve({
        ok: false,
        stdout,
        stderr,
        exitCode: null,
        signal: null,
        timedOut,
        cancelled,
        outputLimitExceeded,
        errorCode: missing ? 'DOCKER_NOT_FOUND' : 'SANDBOX_ERROR',
        errorMessage: missing ? `无法启动 Docker：${executable}` : 'Sandbox 进程启动失败',
      });
    });
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      const ok = exitCode === 0 && !timedOut && !cancelled && !outputLimitExceeded;
      resolve({
        ok,
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        cancelled,
        outputLimitExceeded,
        ...(ok
          ? {}
          : {
              errorCode: timedOut ? 'SANDBOX_TIMEOUT' : cancelled ? 'CANCELLED' : 'SANDBOX_FAILED',
            }),
        ...(ok
          ? {}
          : { errorMessage: timedOut ? `Sandbox 执行超时（${timeoutMs}ms）` : 'Sandbox 执行失败' }),
      });
    });
  });
}

function positive(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new SandboxError('INVALID_REQUEST', `${name} 必须是正整数`);
  return value;
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new SandboxError('INVALID_REQUEST', `${name} 必须是正数`);
  return value;
}

function isMissingExecutable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function readInteger(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new SandboxError('INVALID_REQUEST', `${name} 必须是正整数`);
  return parsed;
}

function readNumber(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new SandboxError('INVALID_REQUEST', `${name} 必须是正数`);
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new SandboxError('INVALID_REQUEST', `${name} 必须是 true/false`);
}
