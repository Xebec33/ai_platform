export interface SandboxExecutionRequest {
  workspaceRoot: string;
  command: ReadonlyArray<string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  environment?: Readonly<Record<string, string>>;
}

export interface SandboxExecutionResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  outputLimitExceeded: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface SandboxExecutor {
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>;
}

export class SandboxError extends Error {
  constructor(
    readonly code: 'INVALID_REQUEST' | 'DOCKER_NOT_FOUND' | 'SANDBOX_ERROR',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SandboxError';
  }
}
