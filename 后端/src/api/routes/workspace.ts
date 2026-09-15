import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ToolError } from '../../tools/types.js';
import {
  relativeWorkspacePath,
  resolveExistingWorkspacePath,
  resolveWritableWorkspacePath,
} from '../../tools/workspace.js';

export interface WorkspaceRoutesOptions {
  workspaceRoot: string;
  maxFiles?: number;
  maxFileBytes?: number;
}

interface WorkspaceEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  options: WorkspaceRoutesOptions,
): Promise<void> {
  const root = options.workspaceRoot;
  const maxFiles = options.maxFiles ?? 500;
  const maxFileBytes = options.maxFileBytes ?? 512 * 1024;

  app.get('/workspace/files', async (_request, reply) => {
    try {
      const files: WorkspaceEntry[] = [];
      await walk(root, '.', files, maxFiles);
      return reply.send({ root, truncated: files.length >= maxFiles, files });
    } catch (error) {
      return workspaceError(reply, error);
    }
  });

  app.get<{ Querystring: { path?: string } }>('/workspace/file', async (request, reply) => {
    const requested = (request.query as { path?: string }).path;
    if (!requested) return reply.code(400).send({ error: '缺少 path 参数' });
    try {
      const resolved = await resolveExistingWorkspacePath(root, requested);
      const details = await stat(resolved);
      if (!details.isFile()) return reply.code(400).send({ error: 'path 不是文件' });
      if (details.size > maxFileBytes)
        return reply.code(422).send({ error: '文件过大，仅支持预览 ' + maxFileBytes + ' 字节以内' });
      const content = await readFile(resolved, 'utf8');
      return reply.send({
        path: relativeWorkspacePath(root, resolved),
        size: details.size,
        content,
      });
    } catch (error) {
      return workspaceError(reply, error);
    }
  });

  app.put<{ Body: { path?: unknown; content?: unknown } }>(
    '/workspace/file',
    async (request, reply) => {
      const body = request.body ?? {};
      const requested = typeof body.path === 'string' ? body.path : '';
      const content = typeof body.content === 'string' ? body.content : undefined;
      if (!requested) return reply.code(400).send({ error: '缺少 path 参数' });
      if (content === undefined) return reply.code(400).send({ error: '缺少 content 参数' });
      if (Buffer.byteLength(content, 'utf8') > maxFileBytes)
        return reply.code(422).send({ error: '文件过大，仅支持 ' + maxFileBytes + ' 字节以内' });
      try {
        const resolved = await resolveWritableWorkspacePath(root, requested);
        await mkdir(path.dirname(resolved), { recursive: true });
        await writeFile(resolved, content, { encoding: 'utf8', flag: 'w' });
        return reply.send({
          path: relativeWorkspacePath(root, resolved),
          bytes: Buffer.byteLength(content, 'utf8'),
          written: true,
        });
      } catch (error) {
        return workspaceError(reply, error);
      }
    },
  );

  app.delete<{ Querystring: { path?: string } }>(
    '/workspace/file',
    async (request, reply) => {
      const requested = (request.query as { path?: string }).path;
      if (!requested) return reply.code(400).send({ error: '缺少 path 参数' });
      try {
        const resolved = await resolveExistingWorkspacePath(root, requested);
        const details = await stat(resolved);
        if (details.isDirectory()) {
          await rm(resolved, { force: false, recursive: true });
          return reply.send({ path: requested, deleted: true });
        }
        if (!details.isFile()) return reply.code(400).send({ error: 'path 不是文件' });
        await rm(resolved, { force: false });
        return reply.send({ path: requested, deleted: true });
      } catch (error) {
        return workspaceError(reply, error);
      }
    },
  );

  app.post<{ Body: { path?: unknown } }>('/workspace/directory', async (request, reply) => {
    const body = request.body ?? {};
    const requested = typeof body.path === 'string' ? body.path : '';
    if (!requested) return reply.code(400).send({ error: '缺少 path 参数' });
    if (requested === '.' || requested === '/')
      return reply.code(400).send({ error: '不能创建 workspace 根目录' });
    try {
      const resolved = await resolveWritableWorkspacePath(root, requested);
      await mkdir(resolved, { recursive: false });
      return reply.send({ path: relativeWorkspacePath(root, resolved), created: true });
    } catch (error) {
      return workspaceError(reply, error);
    }
  });

  async function walk(
    base: string,
    relative: string,
    files: WorkspaceEntry[],
    limit: number,
  ): Promise<void> {
    if (files.length >= limit) return;
    const entries = await readdir(await resolveExistingWorkspacePath(base, relative), {
      withFileTypes: true,
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= limit) return;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const entryPath = relative === '.' ? entry.name : relative + '/' + entry.name;
      if (entry.isDirectory()) {
        files.push({ path: entryPath, name: entry.name, type: 'directory' });
        await walk(base, entryPath, files, limit);
      } else if (entry.isFile()) {
        const details = await stat(path.join(base, entryPath));
        files.push({ path: entryPath, name: entry.name, type: 'file', size: details.size });
      }
    }
  }
}

function workspaceError(reply: FastifyReply, error: unknown) {
  if (error instanceof ToolError)
    return reply.code(error.code === 'WORKSPACE_BOUNDARY' ? 403 : 400).send({
      error: error.message,
      code: error.code,
    });
  return reply.code(500).send({ error: '访问 workspace 失败' });
}
