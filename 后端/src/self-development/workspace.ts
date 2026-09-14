import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runWorkspaceCommand } from '../tools/shell/index.js';

export interface DevelopmentWorkspace {
  id: string;
  repositoryRoot: string;
  path: string;
  baseBranch: string;
  branch: string;
  createdAt: string;
}

export interface WorkspaceDiff {
  status: string;
  diff: string;
}

export interface DevelopmentWorkspaceManagerOptions {
  repositoryRoot: string;
  workspacesRoot?: string;
  baseBranch?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  timeoutMs?: number;
}

export class WorkspaceManagerError extends Error {
  constructor(readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkspaceManagerError';
  }
}

export class DevelopmentWorkspaceManager {
  private readonly repositoryRoot: string;
  private readonly workspacesRoot: string;
  private readonly configuredBaseBranch: string | undefined;
  private readonly gitAuthorName: string;
  private readonly gitAuthorEmail: string;
  private readonly timeoutMs: number;

  constructor(options: DevelopmentWorkspaceManagerOptions) {
    if (!options.repositoryRoot.trim()) throw new WorkspaceManagerError('INVALID_INPUT', 'repositoryRoot 不能为空');
    this.repositoryRoot = path.resolve(options.repositoryRoot);
    this.workspacesRoot = path.resolve(
      options.workspacesRoot ?? path.join(os.tmpdir(), 'ai-workflow-platform-workspaces'),
    );
    this.configuredBaseBranch = options.baseBranch;
    this.gitAuthorName = options.gitAuthorName ?? 'Xebec';
    this.gitAuthorEmail = options.gitAuthorEmail ?? '13815895908@163.com';
    this.timeoutMs = positive(options.timeoutMs ?? 30_000, 'timeoutMs');
    validateRef(this.configuredBaseBranch, 'baseBranch');
  }

  async create(id: string): Promise<DevelopmentWorkspace> {
    validateId(id);
    await mkdir(this.workspacesRoot, { recursive: true });
    const repositoryRoot = await this.git(['rev-parse', '--show-toplevel'], this.repositoryRoot);
    const baseBranch = this.configuredBaseBranch ?? await this.git(['branch', '--show-current'], repositoryRoot);
    if (!baseBranch) throw new WorkspaceManagerError('GIT_ERROR', '无法确定基础分支');
    validateRef(baseBranch, 'baseBranch');
    const branch = `agent/${id}`;
    validateRef(branch, 'branch');
    const workspacePath = path.join(this.workspacesRoot, id);
    await this.ensureNotExists(workspacePath);
    await this.git(['worktree', 'add', '-b', branch, workspacePath, baseBranch], repositoryRoot);
    return {
      id,
      repositoryRoot,
      path: workspacePath,
      baseBranch,
      branch,
      createdAt: new Date().toISOString(),
    };
  }

  async diff(workspace: DevelopmentWorkspace): Promise<WorkspaceDiff> {
    const status = await this.git(['status', '--short', '--branch'], workspace.path);
    const diff = await this.git(['diff', '--no-ext-diff'], workspace.path);
    return { status, diff };
  }

  async commit(workspace: DevelopmentWorkspace, message: string): Promise<string> {
    if (!message.trim()) throw new WorkspaceManagerError('INVALID_INPUT', 'commit message 不能为空');
    await this.git(['add', '--all'], workspace.path);
    return this.git(['commit', '-m', message], workspace.path);
  }

  async merge(workspace: DevelopmentWorkspace): Promise<string> {
    const current = await this.git(['branch', '--show-current'], workspace.repositoryRoot);
    if (current !== workspace.baseBranch)
      throw new WorkspaceManagerError(
        'BASE_BRANCH_NOT_CHECKED_OUT',
        `基础仓库当前分支为 ${current || '(detached)'}，需要先切换到 ${workspace.baseBranch}`,
      );
    const status = await this.git(['status', '--porcelain', '--untracked-files=no'], workspace.repositoryRoot);
    if (status.trim()) throw new WorkspaceManagerError('BASE_WORKTREE_DIRTY', '基础仓库存在未提交修改，拒绝 Merge');
    return this.git(['merge', '--no-ff', '--no-edit', workspace.branch], workspace.repositoryRoot);
  }

  async remove(workspace: DevelopmentWorkspace, force = true): Promise<void> {
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(workspace.path);
    try {
      await this.git(args, workspace.repositoryRoot);
    } finally {
      await rm(workspace.path, { recursive: true, force: true });
    }
  }

  private async ensureNotExists(value: string): Promise<void> {
    try {
      await import('node:fs/promises').then(({ access }) => access(value));
      throw new WorkspaceManagerError('WORKSPACE_EXISTS', `Workspace 已存在：${value}`);
    } catch (error) {
      if (error instanceof WorkspaceManagerError) throw error;
      if (isMissing(error)) return;
      throw error;
    }
  }

  private async git(args: ReadonlyArray<string>, cwd: string): Promise<string> {
    const result = await runWorkspaceCommand(
      'git',
      args,
      { workspaceRoot: cwd },
      {
        cwd,
        timeoutMs: this.timeoutMs,
        env: {
          GIT_AUTHOR_NAME: this.gitAuthorName,
          GIT_AUTHOR_EMAIL: this.gitAuthorEmail,
          GIT_COMMITTER_NAME: this.gitAuthorName,
          GIT_COMMITTER_EMAIL: this.gitAuthorEmail,
        },
      },
    );
    if (result.exitCode !== 0 || result.timedOut)
      throw new WorkspaceManagerError(
        result.timedOut ? 'GIT_TIMEOUT' : 'GIT_ERROR',
        result.stderr.trim() || result.stdout.trim() || 'Git 操作失败',
      );
    return result.stdout.trim();
  }
}

function validateId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value))
    throw new WorkspaceManagerError('INVALID_INPUT', 'taskId 只能包含字母、数字、点、下划线和短横线');
}

function validateRef(value: string | undefined, name: string): void {
  if (value !== undefined && (!value.trim() || value.startsWith('-') || !/^[A-Za-z0-9._/-]+$/.test(value)))
    throw new WorkspaceManagerError('INVALID_INPUT', `${name} 不合法`);
}

function positive(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new WorkspaceManagerError('INVALID_INPUT', `${name} 必须是正整数`);
  return value;
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
