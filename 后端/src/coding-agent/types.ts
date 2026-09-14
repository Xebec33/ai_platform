import type { JsonObject } from '@ai-workflow/shared-types';

export const CODING_AGENT_CAPABILITIES = [
  'repository-read',
  'file-read',
  'file-write',
  'shell',
  'test',
  'git-diff',
] as const;

export type CodingAgentCapability = (typeof CODING_AGENT_CAPABILITIES)[number];

export interface CodingAgentRequest {
  prompt: string;
  workspaceRoot: string;
  model?: string;
  agent?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CodingAgentResult {
  summary: string;
  events: JsonObject[];
  rawOutput: string;
  exitCode: number | null;
  capabilities: readonly CodingAgentCapability[];
}

export interface CodingAgentAdapter {
  readonly id: string;
  execute(request: CodingAgentRequest): Promise<CodingAgentResult>;
}

export type CodingAgentErrorCode =
  | 'INVALID_REQUEST'
  | 'COMMAND_NOT_FOUND'
  | 'PROCESS_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'AGENT_FAILED';

export class CodingAgentError extends Error {
  constructor(
    readonly code: CodingAgentErrorCode,
    message: string,
    readonly retryable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CodingAgentError';
  }
}
