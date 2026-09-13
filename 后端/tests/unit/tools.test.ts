import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileReadTool,
  FileWriteTool,
  GitTool,
  HttpRequestTool,
  SearchTool,
  ShellTool,
  ToolRegistry,
  runWorkspaceCommand,
} from '../../src/tools/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-tool-'));
  roots.push(root);
  return root;
}

describe('Tool System', () => {
  it('reads and writes only inside the workspace', async () => {
    const root = await workspace();
    const context = { workspaceRoot: root };
    const writer = new FileWriteTool();
    const reader = new FileReadTool();

    await expect(
      writer.execute({ path: 'nested/result.txt', content: 'hello' }, context),
    ).resolves.toMatchObject({
      ok: true,
      output: { path: 'nested/result.txt', bytes: 5 },
    });
    await expect(reader.execute({ path: 'nested/result.txt' }, context)).resolves.toMatchObject({
      ok: true,
      output: { content: 'hello' },
    });
    await expect(reader.execute({ path: '../outside.txt' }, context)).resolves.toMatchObject({
      ok: false,
      error: { code: 'WORKSPACE_BOUNDARY' },
    });
  });

  it('executes safe commands and rejects file-capable or composed commands', async () => {
    const root = await workspace();
    const shell = new ShellTool({ timeoutMs: 1_000 });
    await expect(
      shell.execute({ command: 'printf "hello"' }, { workspaceRoot: root }),
    ).resolves.toMatchObject({
      ok: true,
      output: { stdout: 'hello', exitCode: 0 },
    });
    await expect(
      shell.execute({ command: 'printf hello; pwd' }, { workspaceRoot: root }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'SHELL_ERROR' },
    });
    await expect(
      shell.execute({ command: 'cat /etc/passwd' }, { workspaceRoot: root }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'COMMAND_NOT_ALLOWED' },
    });
    await expect(
      new ShellTool({ allowedCommands: ['cat'] }).execute(
        { command: 'cat /etc/passwd' },
        { workspaceRoot: root },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'COMMAND_NOT_ALLOWED' },
    });
  });

  it('rejects Git operations when the workspace is nested inside an outer repository', async () => {
    const outer = await workspace();
    const nested = path.join(outer, 'nested');
    await (await import('node:fs/promises')).mkdir(nested);
    await runWorkspaceCommand('git', ['init'], { workspaceRoot: outer }, { cwd: outer });
    await expect(
      new GitTool().execute({ operation: 'status' }, { workspaceRoot: nested }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'WORKSPACE_BOUNDARY' },
    });
  });

  it('exposes Git status through the same tool contract', async () => {
    const root = await workspace();
    await writeFile(path.join(root, 'tracked.txt'), 'content');
    await runWorkspaceCommand(
      'git',
      ['init'],
      { workspaceRoot: root },
      { cwd: root, timeoutMs: 2_000 },
    );
    const git = new GitTool();
    await expect(
      git.execute({ operation: 'status' }, { workspaceRoot: root }),
    ).resolves.toMatchObject({
      ok: true,
      output: { operation: 'status', exitCode: 0 },
    });
    await expect(
      git.execute({ operation: 'diff', paths: ['../outside.txt'] }, { workspaceRoot: root }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'WORKSPACE_BOUNDARY' },
    });
  });

  it('searches workspace text and enforces HTTP domain allowlist', async () => {
    const root = await workspace();
    await writeFile(path.join(root, 'search.txt'), 'first line\nneedle here');
    await expect(
      new SearchTool().execute({ query: 'needle' }, { workspaceRoot: root }),
    ).resolves.toMatchObject({
      ok: true,
      output: { matches: [{ path: 'search.txt', line: 2 }] },
    });
    await expect(
      new HttpRequestTool().execute({ url: 'https://example.com' }, { workspaceRoot: root }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'HTTP_DOMAIN_NOT_ALLOWED' },
    });
  });

  it('registers tools and rejects duplicate or unknown tools', async () => {
    const registry = new ToolRegistry([new FileReadTool()]);
    expect(registry.list()).toHaveLength(1);
    expect(() => registry.register(new FileReadTool())).toThrow('Tool 已注册');
    await expect(
      registry.execute('missing', {}, { workspaceRoot: await workspace() }),
    ).rejects.toThrow('Tool 不存在');
    const file = await workspace();
    await writeFile(path.join(file, 'a.txt'), 'a');
    await expect(
      registry.execute('file_read', { path: 'a.txt' }, { workspaceRoot: file }),
    ).resolves.toMatchObject({
      ok: true,
      output: { content: 'a' },
    });
    await expect(readFile(path.join(file, 'a.txt'), 'utf8')).resolves.toBe('a');
  });
});
