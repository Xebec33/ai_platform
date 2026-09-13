import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { JsonObject } from '@ai-workflow/shared-types';
import { relativeWorkspacePath, resolveExistingWorkspacePath } from '../workspace.js';
import {
  optionalPositiveInteger,
  optionalString,
  requiredString,
  toolFailure,
  type Tool,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from '../types.js';

const DEFAULT_IGNORED = new Set(['.git', 'node_modules', 'dist', 'coverage', '.vite']);

export class SearchTool implements Tool {
  readonly name = 'search';
  readonly description = '在 workspace 内递归搜索文本内容';
  readonly inputSchema: JsonObject = {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string' },
      path: { type: 'string' },
      maxResults: { type: 'integer', minimum: 1 },
      maxFileBytes: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
  };

  constructor(private readonly ignored = DEFAULT_IGNORED) {}

  async execute(input: JsonObject, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      const query = requiredString(input, 'query');
      const root = await resolveExistingWorkspacePath(
        context.workspaceRoot,
        optionalString(input, 'path') ?? '.',
      );
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) return toolFailure('INVALID_INPUT', 'path 必须是目录');
      const maxResults = optionalPositiveInteger(input, 'maxResults') ?? 50;
      const maxFileBytes = optionalPositiveInteger(input, 'maxFileBytes') ?? 512 * 1024;
      const matches: JsonObject[] = [];
      await visit(root, query, context, matches, maxResults, maxFileBytes, this.ignored);
      return {
        ok: true,
        output: {
          query,
          path: relativeWorkspacePath(context.workspaceRoot, root),
          matches,
          truncated: matches.length >= maxResults,
        },
      };
    } catch (error) {
      return toolFailure('SEARCH_ERROR', error);
    }
  }
}

async function visit(
  directory: string,
  query: string,
  context: ToolExecutionContext,
  matches: JsonObject[],
  maxResults: number,
  maxFileBytes: number,
  ignored: ReadonlySet<string>,
): Promise<void> {
  if (matches.length >= maxResults || context.signal?.aborted) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (matches.length >= maxResults || context.signal?.aborted) return;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name))
        await visit(
          path.join(directory, entry.name),
          query,
          context,
          matches,
          maxResults,
          maxFileBytes,
          ignored,
        );
      continue;
    }
    if (!entry.isFile()) continue;
    const filePath = path.join(directory, entry.name);
    const details = await stat(filePath);
    if (details.size > maxFileBytes) continue;
    const content = await readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (matches.length >= maxResults || !line.toLowerCase().includes(query.toLowerCase())) return;
      matches.push({
        path: relativeWorkspacePath(context.workspaceRoot, filePath),
        line: index + 1,
        text: line,
      });
    });
  }
}
