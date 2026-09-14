import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SandboxExecutionResult, SandboxExecutor } from '../sandbox/index.js';
import type { WorkflowRunResult } from '../workflow/runtime/index.js';
import {
  DevelopmentWorkspaceManager,
  type DevelopmentWorkspace,
  type WorkspaceDiff,
} from './workspace.js';

export interface DevelopmentSessionResult {
  workspace: DevelopmentWorkspace;
  run: WorkflowRunResult;
  merged: boolean;
  mergeOutput?: string;
  mergeError?: string;
}

export interface DevelopmentSessionManagerOptions {
  workspaceManager: DevelopmentWorkspaceManager;
  sandboxExecutor: SandboxExecutor;
}

const SESSION_SUFFIX = '.session.json';
const RESULT_SUFFIX = '.result.json';

export class DevelopmentSessionManager {
  private readonly sessions = new Map<string, DevelopmentWorkspace>();
  private readonly results = new Map<string, DevelopmentSessionResult>();

  constructor(private readonly options: DevelopmentSessionManagerOptions) {}

  async restore(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.options.workspaceManager.workspacesRoot);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith(SESSION_SUFFIX)) continue;
      const taskId = entry.slice(0, -SESSION_SUFFIX.length);
      try {
        const workspace = JSON.parse(
          await readFile(this.sessionFile(taskId), 'utf8'),
        ) as DevelopmentWorkspace;
        await access(workspace.path);
        this.sessions.set(workspace.id, workspace);
        try {
          this.results.set(
            workspace.id,
            JSON.parse(await readFile(this.resultFile(workspace.id), 'utf8')) as DevelopmentSessionResult,
          );
        } catch {
          // 结果尚未写入（运行中或未记录），仅恢复会话
        }
      } catch {
        // 目录已不存在或文件损坏，跳过
      }
    }
  }

  async create(taskId: string): Promise<DevelopmentWorkspace> {
    const existing = this.sessions.get(taskId);
    if (existing) return existing;
    const workspace = await this.options.workspaceManager.create(taskId);
    this.sessions.set(taskId, workspace);
    await mkdir(this.options.workspaceManager.workspacesRoot, { recursive: true });
    await writeFile(this.sessionFile(taskId), JSON.stringify(workspace, null, 2), 'utf8');
    return workspace;
  }

  get(taskId: string): DevelopmentWorkspace | undefined {
    return this.sessions.get(taskId);
  }

  list(): DevelopmentWorkspace[] {
    return [...this.sessions.values()];
  }

  async record(taskId: string, result: DevelopmentSessionResult): Promise<void> {
    this.results.set(taskId, result);
    await writeFile(this.resultFile(taskId), JSON.stringify(result), 'utf8');
  }

  getResult(taskId: string): DevelopmentSessionResult | undefined {
    return this.results.get(taskId);
  }

  async diff(taskId: string): Promise<WorkspaceDiff> {
    return this.options.workspaceManager.diff(this.required(taskId));
  }

  async commit(taskId: string, message: string): Promise<string> {
    return this.options.workspaceManager.commit(this.required(taskId), message);
  }

  async merge(taskId: string): Promise<string> {
    return this.options.workspaceManager.merge(this.required(taskId));
  }

  async executeSandbox(
    taskId: string,
    command: ReadonlyArray<string>,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<SandboxExecutionResult> {
    const workspace = this.required(taskId);
    return this.options.sandboxExecutor.execute({
      workspaceRoot: workspace.path,
      command,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  async remove(taskId: string, force = true): Promise<void> {
    const workspace = this.required(taskId);
    await this.options.workspaceManager.remove(workspace, force);
    this.sessions.delete(taskId);
    this.results.delete(taskId);
    await rm(this.sessionFile(taskId), { force: true });
    await rm(this.resultFile(taskId), { force: true });
  }

  private sessionFile(taskId: string): string {
    return path.join(this.options.workspaceManager.workspacesRoot, taskId + SESSION_SUFFIX);
  }

  private resultFile(taskId: string): string {
    return path.join(this.options.workspaceManager.workspacesRoot, taskId + RESULT_SUFFIX);
  }

  private required(taskId: string): DevelopmentWorkspace {
    const workspace = this.sessions.get(taskId);
    if (!workspace) throw new Error(`开发 Workspace 不存在：${taskId}`);
    return workspace;
  }
}

export * from './workspace.js';
