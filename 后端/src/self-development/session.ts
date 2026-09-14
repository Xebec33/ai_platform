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

export class DevelopmentSessionManager {
  private readonly sessions = new Map<string, DevelopmentWorkspace>();
  private readonly results = new Map<string, DevelopmentSessionResult>();

  constructor(private readonly options: DevelopmentSessionManagerOptions) {}

  async create(taskId: string): Promise<DevelopmentWorkspace> {
    const existing = this.sessions.get(taskId);
    if (existing) return existing;
    const workspace = await this.options.workspaceManager.create(taskId);
    this.sessions.set(taskId, workspace);
    return workspace;
  }

  get(taskId: string): DevelopmentWorkspace | undefined {
    return this.sessions.get(taskId);
  }

  list(): DevelopmentWorkspace[] {
    return [...this.sessions.values()];
  }

  record(taskId: string, result: DevelopmentSessionResult): void {
    this.results.set(taskId, result);
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
  }

  private required(taskId: string): DevelopmentWorkspace {
    const workspace = this.sessions.get(taskId);
    if (!workspace) throw new Error(`开发 Workspace 不存在：${taskId}`);
    return workspace;
  }
}

export * from './workspace.js';
