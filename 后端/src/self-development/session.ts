import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SandboxExecutionResult, SandboxExecutor } from '../sandbox/index.js';
import type { WorkflowRunResult } from '../workflow/runtime/index.js';
import type { WorkflowNodeRun } from '../workflow/runtime/types.js';
import type { WorkflowRunEvent } from '../workflow/runtime/events.js';
import { compactNodeRun } from './compact.js';
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

export type SelfDevelopmentPhase =
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'MERGING'
  | 'MERGED'
  | 'MERGE_FAILED';

export interface SelfDevelopmentProgress {
  taskId: string;
  runId: string;
  phase: SelfDevelopmentPhase;
  currentNode?: string;
  iteration?: number;
  nodeRuns: WorkflowNodeRun[];
  error?: string;
  updatedAt: string;
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
  private readonly progress = new Map<string, SelfDevelopmentProgress>();

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

  startProgress(taskId: string, runId: string): SelfDevelopmentProgress {
    const record: SelfDevelopmentProgress = {
      taskId,
      runId,
      phase: 'RUNNING',
      nodeRuns: [],
      updatedAt: new Date().toISOString(),
    };
    this.progress.set(taskId, record);
    return record;
  }

  recordEvent(taskId: string, event: WorkflowRunEvent): void {
    const record = this.progress.get(taskId);
    if (!record) return;
    const touch = (): void => {
      record.updatedAt = new Date().toISOString();
    };
    switch (event.type) {
      case 'NODE_STARTED':
        if (event.nodeRun) {
          const existing = record.nodeRuns.findIndex((run) => run.id === event.nodeRun?.id);
          if (existing >= 0) record.nodeRuns[existing] = event.nodeRun;
          else record.nodeRuns.push(event.nodeRun);
        }
        record.currentNode = event.nodeId;
        touch();
        break;
      case 'NODE_COMPLETED':
      case 'NODE_FAILED':
        if (event.nodeRun) {
          const existing = record.nodeRuns.findIndex((run) => run.id === event.nodeRun?.id);
          if (existing >= 0) record.nodeRuns[existing] = event.nodeRun;
          else record.nodeRuns.push(event.nodeRun);
        }
        if (record.currentNode === event.nodeId) record.currentNode = undefined;
        touch();
        break;
      case 'LOOP_STARTED':
        record.currentNode = event.nodeId ?? record.currentNode;
        touch();
        break;
      case 'LOOP_ITERATION':
      case 'LOOP_CONTINUED':
        if (event.iteration !== undefined) record.iteration = event.iteration;
        touch();
        break;
      case 'RUN_COMPLETED':
        record.phase = (event.status as SelfDevelopmentPhase) ?? 'SUCCESS';
        record.currentNode = undefined;
        touch();
        break;
      case 'RUN_FAILED':
      case 'RUN_CANCELLED':
        record.phase = event.type === 'RUN_FAILED' ? 'FAILED' : 'CANCELLED';
        if (event.error) record.error = event.error;
        record.currentNode = undefined;
        touch();
        break;
      default:
        break;
    }
  }

  setPhase(taskId: string, phase: SelfDevelopmentPhase, error?: string): void {
    const record = this.progress.get(taskId);
    if (!record) return;
    record.phase = phase;
    if (error !== undefined) record.error = error;
    record.updatedAt = new Date().toISOString();
  }

  getProgress(taskId: string): SelfDevelopmentProgress | undefined {
    const record = this.progress.get(taskId);
    return record
      ? { ...record, nodeRuns: record.nodeRuns.map((nodeRun) => compactNodeRun(nodeRun)) }
      : undefined;
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
