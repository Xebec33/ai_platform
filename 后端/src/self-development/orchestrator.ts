import { AgentRegistry } from '../agents/index.js';
import { createWorkflowRuntime, type WorkflowRunResult, type WorkflowRuntimeOptions } from '../workflow/runtime/index.js';
import type { ToolRegistry } from '../tools/index.js';
import {
  DevelopmentWorkspaceManager,
  DevelopmentSessionManager,
  type DevelopmentWorkspace,
} from './session.js';
import { createSelfDevelopmentWorkflow, type SelfDevelopmentWorkflowOptions } from './workflow.js';

export interface SelfDevelopmentOrchestratorOptions {
  sessions: DevelopmentSessionManager;
  workspaceManager: DevelopmentWorkspaceManager;
  toolRegistry?: ToolRegistry;
  agentRegistry: AgentRegistry;
  runtime?: Omit<WorkflowRuntimeOptions, 'workspaceRoot' | 'toolRegistry' | 'agentRegistry'>;
  model?: string;
  codingModel?: string;
}

export interface SelfDevelopmentResult {
  workspace: DevelopmentWorkspace;
  run: WorkflowRunResult;
  merged: boolean;
  mergeOutput?: string;
}

export class SelfDevelopmentOrchestrator {
  constructor(private readonly options: SelfDevelopmentOrchestratorOptions) {}

  async execute(workflowOptions: SelfDevelopmentWorkflowOptions = {}): Promise<SelfDevelopmentResult> {
    const taskId = workflowOptions.taskId ?? `task-${Date.now()}`;
    const workspace = await this.options.sessions.create(taskId);
    const defaults: SelfDevelopmentWorkflowOptions = {};
    if (this.options.model) defaults.model = this.options.model;
    if (this.options.codingModel) defaults.codingModel = this.options.codingModel;
    const workflow = createSelfDevelopmentWorkflow({ ...defaults, ...workflowOptions, taskId });
    const runtime = createWorkflowRuntime(workflow, {
      ...this.options.runtime,
      agentRegistry: this.options.agentRegistry,
      toolRegistry: this.options.toolRegistry,
      workspaceRoot: workspace.path,
    });
    const run = await runtime.execute({ variables: { requirement: workflowOptions.requirement ?? workflow.variables.requirement } });
    if (run.status !== 'SUCCESS') {
      await this.options.sessions.record(taskId, { workspace, run, merged: false });
      return { workspace, run, merged: false };
    }
    let mergeOutput: string;
    try {
      mergeOutput = await this.options.workspaceManager.merge(workspace);
    } catch (error) {
      await this.options.sessions.record(taskId, {
        workspace,
        run,
        merged: false,
        mergeError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    await this.options.sessions.record(taskId, { workspace, run, merged: true, mergeOutput });
    return { workspace, run, merged: true, mergeOutput };
  }
}
