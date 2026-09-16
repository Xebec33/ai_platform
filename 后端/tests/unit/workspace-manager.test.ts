import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DevelopmentSessionManager } from '../../src/self-development/session.js';
import { DevelopmentWorkspaceManager } from '../../src/self-development/workspace.js';
import { runWorkspaceCommand } from '../../src/tools/shell/index.js';

async function git(root: string, args: string[]): Promise<void> {
  const result = await runWorkspaceCommand('git', args, { workspaceRoot: root }, { cwd: root });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
}

describe('DevelopmentWorkspaceManager', () => {
  it('merges even when the base repository has untracked files, but rejects tracked modifications', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-repository-'));
    const workspacesRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-workspaces-'));
    try {
      await git(repositoryRoot, ['init', '-b', 'main']);
      await writeFile(path.join(repositoryRoot, 'README.txt'), 'base\n');
      await git(repositoryRoot, ['add', 'README.txt']);
      await git(repositoryRoot, ['-c', 'user.name=Bootstrap', '-c', 'user.email=bootstrap@example.com', 'commit', '-m', 'initial']);
      const manager = new DevelopmentWorkspaceManager({ repositoryRoot, workspacesRoot });
      await writeFile(path.join(repositoryRoot, 'untracked.txt'), 'untracked\n');
      const workspace = await manager.create('untracked-tolerance');
      await writeFile(path.join(workspace.path, 'README.txt'), 'changed\n');
      await manager.commit(workspace, 'feat: tolerate untracked files');
      await expect(manager.merge(workspace)).resolves.toContain('Merge');
      expect(await readFile(path.join(repositoryRoot, 'README.txt'), 'utf8')).toBe('changed\n');
      expect(await readFile(path.join(repositoryRoot, 'untracked.txt'), 'utf8')).toBe('untracked\n');
      await manager.remove(workspace);

      await writeFile(path.join(repositoryRoot, 'README.txt'), 'dirty\n');
      const next = await manager.create('dirty-rejection');
      await writeFile(path.join(next.path, 'new.txt'), 'new\n');
      await manager.commit(next, 'feat: next change');
      await expect(manager.merge(next)).rejects.toMatchObject({ code: 'BASE_WORKTREE_DIRTY' });
      await manager.remove(next);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
      await rm(workspacesRoot, { recursive: true, force: true });
    }
  });

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

describe('DevelopmentSessionManager persistence', () => {
  it('records live progress from workflow events', () => {
    const sessions = new DevelopmentSessionManager({ workspaceManager: null as never, sandboxExecutor: null as never });
    sessions.startProgress('task-1', 'self-dev-task-1');
    const nodeRun = (id: string, nodeId: string, status: string) => ({ id, nodeId, status });
    sessions.recordEvent('task-1', {
      type: 'NODE_STARTED',
      nodeId: 'requirement-analyzer',
      nodeRun: nodeRun('n1', 'requirement-analyzer', 'RUNNING') as never,
    } as never);
    let progress = sessions.getProgress('task-1');
    expect(progress?.phase).toBe('RUNNING');
    expect(progress?.currentNode).toBe('requirement-analyzer');
    expect(progress?.nodeRuns).toHaveLength(1);
    sessions.recordEvent('task-1', {
      type: 'NODE_COMPLETED',
      nodeId: 'requirement-analyzer',
      nodeRun: nodeRun('n1', 'requirement-analyzer', 'SUCCESS') as never,
    } as never);
    sessions.recordEvent('task-1', {
      type: 'NODE_STARTED',
      nodeId: 'coding-agent',
      nodeRun: nodeRun('n2', 'coding-agent', 'RUNNING') as never,
    } as never);
    sessions.recordEvent('task-1', { type: 'LOOP_ITERATION', iteration: 2 } as never);
    progress = sessions.getProgress('task-1');
    expect(progress?.currentNode).toBe('coding-agent');
    expect(progress?.iteration).toBe(2);
    expect(progress?.nodeRuns.map((run) => run.status)).toEqual(['SUCCESS', 'RUNNING']);
    sessions.recordEvent('task-1', { type: 'RUN_COMPLETED', status: 'SUCCESS' } as never);
    sessions.setPhase('task-1', 'MERGING');
    sessions.setPhase('task-1', 'MERGED');
    progress = sessions.getProgress('task-1');
    expect(progress?.phase).toBe('MERGED');
    expect(progress?.currentNode).toBeUndefined();
    expect(sessions.getProgress('task-missing')).toBeUndefined();
  });

  it('restores sessions and recorded results from disk after a restart', async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-repository-'));
    const workspacesRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-workspaces-'));
    const sandbox = { execute: async () => { throw new Error('not used'); } };
    try {
      await git(repositoryRoot, ['init', '-b', 'main']);
      await writeFile(path.join(repositoryRoot, 'README.txt'), 'base\n');
      await git(repositoryRoot, ['add', 'README.txt']);
      await git(repositoryRoot, ['-c', 'user.name=Bootstrap', '-c', 'user.email=bootstrap@example.com', 'commit', '-m', 'initial']);
      const workspaceManager = new DevelopmentWorkspaceManager({ repositoryRoot, workspacesRoot });
      const sessions = new DevelopmentSessionManager({ workspaceManager, sandboxExecutor: sandbox as never });
      const workspace = await sessions.create('persisted-task');
      await sessions.record('persisted-task', {
        workspace,
        merged: true,
        mergeOutput: 'Merge made by the ort strategy.',
        run: {
          id: 'run-1',
          workflowId: 'self-development-v1',
          status: 'SUCCESS',
          variables: {},
          nodeRuns: [],
          startedAt: '2026-09-14T00:00:00.000Z',
          iterations: {},
        },
      });

      const revived = new DevelopmentSessionManager({ workspaceManager, sandboxExecutor: sandbox as never });
      await revived.restore();
      expect(revived.list().map((session) => session.id)).toEqual(['persisted-task']);
      expect(revived.getResult('persisted-task')).toMatchObject({
        merged: true,
        mergeOutput: 'Merge made by the ort strategy.',
        run: { status: 'SUCCESS', id: 'run-1' },
      });

      await revived.remove('persisted-task');
      const afterRemove = new DevelopmentSessionManager({ workspaceManager, sandboxExecutor: sandbox as never });
      await afterRemove.restore();
      expect(afterRemove.list()).toEqual([]);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
      await rm(workspacesRoot, { recursive: true, force: true });
    }
  });
});
