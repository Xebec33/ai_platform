import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { JsonObject } from '@ai-workflow/shared-types';
import {
  relativeWorkspacePath,
  resolveExistingWorkspacePath,
  resolveWritableWorkspacePath,
} from '../workspace.js';
import {
  optionalString,
  requiredString,
  toolFailure,
  type Tool,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from '../types.js';

export class FileReadTool implements Tool {
  readonly name = 'file_read';
  readonly description = '读取 workspace 内的 UTF-8 文本文件';
  readonly inputSchema: JsonObject = {
    type: 'object',
    required: ['path'],
    properties: { path: { type: 'string' }, encoding: { type: 'string', enum: ['utf8'] } },
    additionalProperties: false,
  };

  async execute(input: JsonObject, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      const requestedPath = requiredString(input, 'path');
      const encoding = optionalString(input, 'encoding') ?? 'utf8';
      if (encoding !== 'utf8') return toolFailure('INVALID_INPUT', '目前只支持 utf8 编码');
      const resolved = await resolveExistingWorkspacePath(context.workspaceRoot, requestedPath);
      const details = await stat(resolved);
      if (!details.isFile()) return toolFailure('FILE_READ_ERROR', 'path 必须指向文件');
      const content = await readFile(resolved, 'utf8');
      return {
        ok: true,
        output: {
          path: relativeWorkspacePath(context.workspaceRoot, resolved),
          encoding,
          content,
          bytes: Buffer.byteLength(content, 'utf8'),
        },
      };
    } catch (error) {
      return toolFailure(errorCode(error, 'FILE_READ_ERROR'), error);
    }
  }
}

export class FileWriteTool implements Tool {
  readonly name = 'file_write';
  readonly description = '在 workspace 内写入 UTF-8 文本文件';
  readonly inputSchema: JsonObject = {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
      createDirectories: { type: 'boolean' },
    },
    additionalProperties: false,
  };

  async execute(input: JsonObject, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      const requestedPath = requiredString(input, 'path');
      const content = requiredStringAllowEmpty(input, 'content');
      const createDirectories = input.createDirectories !== false;
      const resolved = await resolveWritableWorkspacePath(context.workspaceRoot, requestedPath);
      if (createDirectories) await mkdir(path.dirname(resolved), { recursive: true });
      const parent = await stat(path.dirname(resolved));
      if (!parent.isDirectory()) return toolFailure('FILE_WRITE_ERROR', '目标目录无效');
      await writeFile(resolved, content, { encoding: 'utf8', flag: 'w' });
      return {
        ok: true,
        output: {
          path: relativeWorkspacePath(context.workspaceRoot, resolved),
          bytes: Buffer.byteLength(content, 'utf8'),
          written: true,
        },
      };
    } catch (error) {
      return toolFailure(errorCode(error, 'FILE_WRITE_ERROR'), error);
    }
  }
}

function requiredStringAllowEmpty(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') throw new Error(`Tool 参数 ${key} 必须是字符串`);
  return value;
}

function errorCode(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : fallback;
}
