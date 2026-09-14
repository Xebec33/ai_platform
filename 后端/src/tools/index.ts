import type { JsonObject } from '@ai-workflow/shared-types';
import { FileReadTool, FileWriteTool } from './file/index.js';
import { GitTool } from './git/index.js';
import { ShellTool } from './shell/index.js';
import { HttpRequestTool } from './http/index.js';
import { SearchTool } from './search/index.js';
import { SandboxTool } from './sandbox.js';
import { DemoFixtureTool } from './demo-fixture.js';
import type { SandboxExecutor } from '../sandbox/index.js';
import {
  ToolError,
  type Tool,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolSpec,
} from './types.js';
import { normalizeWorkspaceRoot } from './workspace.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(entries: ReadonlyArray<Tool> = []) {
    for (const tool of entries) this.register(tool);
  }

  register(tool: Tool): this {
    if (!tool.name.trim()) throw new ToolError('REGISTRY_ERROR', 'Tool name 不能为空');
    if (this.tools.has(tool.name))
      throw new ToolError('REGISTRY_ERROR', `Tool 已注册：${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): ToolSpec[] {
    return [...this.tools.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  async execute(
    name: string,
    input: JsonObject,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolError('TOOL_NOT_FOUND', `Tool 不存在：${name}`);
    return tool.execute(input, context);
  }
}

export function createDefaultToolRegistry(
  workspaceRoot = process.cwd(),
  sandboxExecutor?: SandboxExecutor,
): ToolRegistry {
  normalizeWorkspaceRoot(workspaceRoot);
  return new ToolRegistry([
    new FileReadTool(),
    new FileWriteTool(),
    new ShellTool(),
    new GitTool(),
    new HttpRequestTool(),
    new SearchTool(),
    new DemoFixtureTool(),
    ...(sandboxExecutor ? [new SandboxTool(sandboxExecutor)] : []),
  ]);
}

export * from './types.js';
export * from './workspace.js';
export * from './file/index.js';
export * from './shell/index.js';
export * from './git/index.js';
export * from './http/index.js';
export * from './search/index.js';
export * from './sandbox.js';
export * from './demo-fixture.js';
