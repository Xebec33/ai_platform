import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DevelopmentWorkspaceManager } from '../../src/self-development/workspace.js';
import { runWorkspaceCommand } from '../../src/tools/shell/index.js';

async function git(root: string, args: string[]): Promise<void> {
  const result = await runWorkspaceCommand('git', args, { workspaceRoot: root }, { cwd: root });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
}

describe('DevelopmentWorkspaceManager', () => {
  it('creates an isolated branch, commits changes, diffs, merges and removes it', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-repository-'));
    const workspacesRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-workspaces-'));
    try {
      await git(repositoryRoot, ['init', '-b', 'main']);
      await writeFile(path.join(repositoryRoot, 'README.txt'), 'base\n');
      await git(repositoryRoot, ['add', 'README.txt']);
      await git(repositoryRoot, ['-c', 'user.name=Bootstrap', '-c', 'user.email=bootstrap@example.com', 'commit', '-m', 'initial']);
      const manager = new DevelopmentWorkspaceManager({ repositoryRoot, workspacesRoot });
      const workspace = await manager.create('http-node');
      expect(workspace.branch).toBe('agent/http-node');
      expect(workspace.baseBranch).toBe('main');
      await writeFile(path.join(workspace.path, 'README.txt'), 'changed\n');
      await writeFile(path.join(workspace.path, 'new.txt'), 'new\n');
      const beforeCommit = await manager.diff(workspace);
      expect(beforeCommit.status).toContain('README.txt');
      expect(beforeCommit.diff).toContain('changed');
      await manager.commit(workspace, 'feat: add http node');
      await manager.merge(workspace);
      expect(await readFile(path.join(repositoryRoot, 'README.txt'), 'utf8')).toBe('changed\n');
      expect(await readFile(path.join(repositoryRoot, 'new.txt'), 'utf8')).toBe('new\n');
      await manager.remove(workspace);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
      await rm(workspacesRoot, { recursive: true, force: true });
    }
  });
});
