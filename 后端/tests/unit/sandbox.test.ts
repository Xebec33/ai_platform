import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DockerSandboxExecutor } from '../../src/sandbox/index.js';

async function fakeDocker(): Promise<{ root: string; executable: string; argsFile: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-docker-'));
  const executable = path.join(root, 'docker');
  const argsFile = path.join(root, 'args');
  await writeFile(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\nprintf '%s\\n' '{"ok":true}'\n`,
    'utf8',
  );
  await chmod(executable, 0o755);
  return { root, executable, argsFile };
}

describe('DockerSandboxExecutor', () => {
  it('runs a command with isolation and resource flags', async () => {
    const fixture = await fakeDocker();
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-sandbox-workspace-'));
    try {
      const result = await new DockerSandboxExecutor({
        executable: fixture.executable,
        image: 'sandbox:test',
        memoryMb: 256,
        cpus: 0.5,
        pidsLimit: 32,
      }).execute({ workspaceRoot: workspace, command: ['npm', 'test'] });
      expect(result.ok).toBe(true);
      expect(result.stdout).toContain('{"ok":true}');
      const args = await readFile(fixture.argsFile, 'utf8');
      expect(args).toContain('--network\nnone');
      expect(args).toContain('--memory\n256m');
      expect(args).toContain('--cpus\n0.5');
      expect(args).toContain('sandbox:test\nnpm\ntest');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('classifies a missing Docker executable', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-sandbox-workspace-'));
    try {
      const result = await new DockerSandboxExecutor({ executable: path.join(workspace, 'missing') }).execute({
        workspaceRoot: workspace,
        command: ['echo', 'hello'],
      });
      expect(result).toMatchObject({ ok: false, errorCode: 'DOCKER_NOT_FOUND' });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
