import type { JsonObject } from '@ai-workflow/shared-types';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export interface ToolExecutionContext {
  workspaceRoot: string;
  signal?: AbortSignal;
}

export interface ToolErrorInfo {
  code: string;
  message: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  output?: JsonObject;
  error?: ToolErrorInfo;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  execute(input: JsonObject, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}

export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ToolError';
  }
}

export function toolFailure(code: string, error: unknown): ToolExecutionResult {
  return {
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

export function requiredString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim())
    throw new ToolError('INVALID_INPUT', `Tool 参数 ${key} 必须是非空字符串`);
  return value;
}

export function optionalString(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string')
    throw new ToolError('INVALID_INPUT', `Tool 参数 ${key} 必须是字符串`);
  return value;
}

export function optionalPositiveInteger(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    throw new ToolError('INVALID_INPUT', `Tool 参数 ${key} 必须是正整数`);
  return value;
}
