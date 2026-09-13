import { realpathSync } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ToolError } from './types.js';

export function normalizeWorkspaceRoot(root: string): string {
  if (!root.trim()) throw new ToolError('WORKSPACE_ERROR', 'workspaceRoot 不能为空');
  try {
    return realpathSync(root);
  } catch (error) {
    throw new ToolError('WORKSPACE_ERROR', `workspaceRoot 不存在：${root}`, false, {
      cause: error,
    });
  }
}

export function resolveWorkspacePath(workspaceRoot: string, requestedPath: string): string {
  if (!requestedPath.trim()) throw new ToolError('INVALID_INPUT', 'path 不能为空');
  if (requestedPath.includes('\0')) throw new ToolError('INVALID_INPUT', 'path 不能包含 NUL 字符');
  const root = normalizedRoot(workspaceRoot);
  const resolved = path.resolve(root, requestedPath);
  assertWithinWorkspace(root, resolved);
  return resolved;
}

export async function resolveExistingWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
): Promise<string> {
  const resolved = resolveWorkspacePath(workspaceRoot, requestedPath);
  const actual = await realpath(resolved);
  assertWithinWorkspace(normalizedRoot(workspaceRoot), actual);
  return actual;
}

export async function resolveWritableWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
): Promise<string> {
  const resolved = resolveWorkspacePath(workspaceRoot, requestedPath);
  const parent = await realpathNearestExisting(path.dirname(resolved));
  assertWithinWorkspace(normalizedRoot(workspaceRoot), parent);
  try {
    const existing = await lstat(resolved);
    if (existing.isSymbolicLink()) throw new ToolError('WORKSPACE_BOUNDARY', '不能写入符号链接');
  } catch (error) {
    if (isMissingFileError(error)) return resolved;
    throw error;
  }
  return resolved;
}

export async function resolveWorkspaceCommandPath(
  workspaceRoot: string,
  requestedPath: string,
): Promise<string> {
  const root = normalizedRoot(workspaceRoot);
  const resolved = resolveWorkspacePath(root, requestedPath);
  const parent = await realpathNearestExisting(path.dirname(resolved));
  assertWithinWorkspace(root, parent);
  try {
    const details = await lstat(resolved);
    if (details.isSymbolicLink())
      throw new ToolError('WORKSPACE_BOUNDARY', '命令路径不能是符号链接');
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  if (requestedPath.startsWith(':'))
    throw new ToolError('INVALID_INPUT', '命令路径不能使用 Git pathspec magic');
  return path.relative(root, resolved) || '.';
}

export async function ensureWorkspaceDirectory(
  workspaceRoot: string,
  requestedPath: string | undefined,
): Promise<{ path: string; relativePath: string }> {
  const relativePath = requestedPath ?? '.';
  const resolved = await resolveExistingWorkspacePath(workspaceRoot, relativePath);
  const details = await stat(resolved);
  if (!details.isDirectory()) throw new ToolError('INVALID_INPUT', 'cwd 必须是目录');
  return {
    path: resolved,
    relativePath: path.relative(normalizedRoot(workspaceRoot), resolved) || '.',
  };
}

export function relativeWorkspacePath(workspaceRoot: string, value: string): string {
  return path.relative(normalizedRoot(workspaceRoot), value) || '.';
}

function normalizedRoot(workspaceRoot: string): string {
  try {
    return realpathSync(workspaceRoot);
  } catch (error) {
    throw new ToolError('WORKSPACE_ERROR', `workspaceRoot 不存在：${workspaceRoot}`, false, {
      cause: error,
    });
  }
}

async function realpathNearestExisting(value: string): Promise<string> {
  let current = value;
  while (true) {
    try {
      return await realpath(current);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function assertWithinWorkspace(root: string, value: string): void {
  const relative = path.relative(root, value);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new ToolError('WORKSPACE_BOUNDARY', '路径必须位于 workspaceRoot 内');
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
