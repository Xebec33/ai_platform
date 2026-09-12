import {
  validateWorkflow,
  type AgentNode,
  type JsonObject,
  type JsonValue,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@ai-workflow/shared-types';
import {
  WorkflowRuntimeError,
  WorkflowValidationError,
  type AgentExecutionContext,
  type AgentExecutorLike,
  type WorkflowRunOptions,
  type WorkflowRunResult,
  type WorkflowRuntimeOptions,
  type WorkflowNodeRun,
} from './types.js';
import { AgentExecutionError, createDefaultAgentExecutor } from '../../agents/index.js';

const defaultAgentExecutor = createDefaultAgentExecutor();

export class WorkflowRuntime {
  private readonly agentExecutor: AgentExecutorLike;
  private readonly timeout?: number;
  private readonly retries: number;
  private readonly makeRunId: () => string;
  private readonly makeNodeRunId: (id: string, index: number) => string;

  constructor(
    private readonly workflow: WorkflowDefinition,
    options: WorkflowRuntimeOptions = {},
  ) {
    const validation = validateWorkflow(workflow);
    if (!validation.valid)
      throw new WorkflowValidationError('Workflow 校验失败', validation.issues);
    if (options.agentTimeoutMs !== undefined && options.agentTimeoutMs <= 0)
      throw new WorkflowRuntimeError('agentTimeoutMs 必须是正数');
    if (
      options.maxAgentRetries !== undefined &&
      (!Number.isInteger(options.maxAgentRetries) || options.maxAgentRetries < 0)
    )
      throw new WorkflowRuntimeError('maxAgentRetries 必须是非负整数');
    this.agentExecutor = options.agentExecutor ?? defaultAgentExecutor;
    this.timeout = options.agentTimeoutMs;
    this.retries = options.maxAgentRetries ?? 0;
    this.makeRunId = options.runIdFactory ?? (() => 'run-' + Date.now());
    this.makeNodeRunId = options.nodeRunIdFactory ?? ((id, index) => id + '-run-' + (index + 1));
  }

  run(options: WorkflowRunOptions = {}): Promise<WorkflowRunResult> {
    return this.execute(options);
  }

  async execute(options: WorkflowRunOptions = {}): Promise<WorkflowRunResult> {
    const variables = clone({ ...this.workflow.variables, ...(options.variables ?? {}) });
    const nodeRuns: WorkflowNodeRun[] = [];
    const outputs: Record<string, JsonObject> = {};
    const result: WorkflowRunResult = {
      id: this.makeRunId(),
      workflowId: this.workflow.id,
      status: 'RUNNING',
      variables,
      nodeRuns,
      startedAt: new Date().toISOString(),
    };
    let current = this.start();
    let lastOutput: JsonObject | undefined;
    let active: WorkflowNodeRun | undefined;

    try {
      for (let index = 0; ; index += 1) {
        checkAbort(options.signal);
        const run: WorkflowNodeRun = {
          id: this.makeNodeRunId(current.id, index),
          nodeId: current.id,
          status: 'RUNNING',
          attempts: 0,
          startedAt: new Date().toISOString(),
        };
        nodeRuns.push(run);
        active = run;
        if (current.type === 'start') {
          run.input = variables;
          run.attempts = 1;
          run.status = 'SUCCESS';
          current = this.next(current.id);
        } else if (current.type === 'agent') {
          const input = inputOf(current, variables, outputs);
          run.input = input;
          const output = await this.agent(current, input, variables, outputs, run, options.signal);
          run.output = output;
          run.status = 'SUCCESS';
          outputs[current.id] = output;
          lastOutput = output;
          const key = current.outputKey ?? current.config.outputKey;
          if (key) variables[key] = output;
          current = this.next(current.id);
        } else if (current.type === 'end') {
          run.input = lastOutput ?? variables;
          run.attempts = 1;
          run.status = 'SUCCESS';
          run.finishedAt = new Date().toISOString();
          result.output = lastOutput ?? variables;
          break;
        } else
          throw new WorkflowRuntimeError(
            'Phase 3 暂不支持执行 ' + current.type + ' 节点：' + current.id,
          );
        run.finishedAt = new Date().toISOString();
        active = undefined;
      }
      result.status = 'SUCCESS';
      result.finishedAt = new Date().toISOString();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (active?.status === 'RUNNING') {
        active.status = 'FAILED';
        active.error = message;
        active.errorCode = error instanceof AgentExecutionError ? error.code : undefined;
        active.finishedAt = new Date().toISOString();
      }
      result.status = options.signal?.aborted ? 'CANCELLED' : 'FAILED';
      result.error = message;
      result.finishedAt = new Date().toISOString();
      return result;
    }
  }

  private start(): WorkflowNode {
    const node = this.workflow.nodes.find((item) => item.type === 'start');
    if (!node) throw new WorkflowRuntimeError('Workflow 缺少 Start 节点');
    return node;
  }

  private next(id: string): WorkflowNode {
    const edges = this.workflow.edges.filter((edge) => edge.source === id);
    if (edges.length !== 1)
      throw new WorkflowRuntimeError(
        '节点 ' + id + ' 必须有且只有一条出边，实际为 ' + edges.length,
      );
    const node = this.workflow.nodes.find((item) => item.id === edges[0]?.target);
    if (!node) throw new WorkflowRuntimeError('边指向不存在节点');
    return node;
  }

  private async agent(
    node: AgentNode,
    input: JsonValue,
    variables: JsonObject,
    outputs: Readonly<Record<string, JsonObject>>,
    run: WorkflowNodeRun,
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    let last: unknown;
    for (let attempt = 1; attempt <= this.retries + 1; attempt += 1) {
      checkAbort(signal);
      run.attempts = attempt;
      try {
        const context: AgentExecutionContext = {
          node,
          input,
          variables,
          nodeOutputs: outputs,
          signal,
        };
        const promise =
          typeof this.agentExecutor === 'function'
            ? this.agentExecutor(context)
            : this.agentExecutor.execute(context);
        const value = await timeout(promise, this.timeout);
        if (!isObject(value.output)) throw new WorkflowRuntimeError('Agent 输出必须是对象');
        return clone(value.output);
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof Error ? last : new WorkflowRuntimeError('Agent 执行失败');
  }
}

export function createWorkflowRuntime(
  workflow: WorkflowDefinition,
  options: WorkflowRuntimeOptions = {},
): WorkflowRuntime {
  return new WorkflowRuntime(workflow, options);
}

function inputOf(
  node: AgentNode,
  variables: JsonObject,
  outputs: Readonly<Record<string, JsonObject>>,
): JsonValue {
  if (node.input) return resolve(node.input, variables, outputs);
  if (typeof node.config.input === 'string') return resolve(node.config.input, variables, outputs);
  return variables;
}

function resolve(
  value: JsonValue,
  variables: JsonObject,
  outputs: Readonly<Record<string, JsonObject>>,
): JsonValue {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (exact?.[1]) return lookup(exact[1], variables, outputs) ?? value;
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) =>
      stringify(lookup(path, variables, outputs)),
    );
  }
  if (Array.isArray(value)) return value.map((item) => resolve(item, variables, outputs));
  if (isObject(value)) {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value))
      if (item !== undefined) result[key] = resolve(item, variables, outputs);
    return result;
  }
  return value;
}

function lookup(
  path: string,
  variables: JsonObject,
  outputs: Readonly<Record<string, JsonObject>>,
): JsonValue | undefined {
  const parts = path.trim().split('.');
  const root = parts.shift();
  let value: JsonValue | undefined =
    root === 'variables' ? variables : root === 'nodes' ? outputs[parts.shift() ?? ''] : undefined;
  for (const part of parts) {
    if (!isObject(value)) return undefined;
    value = value[part];
  }
  return value;
}

function stringify(value: JsonValue | undefined): string {
  return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
}
function clone(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WorkflowRuntimeError('Workflow 已取消');
}
async function timeout<T>(promise: Promise<T>, ms?: number): Promise<T> {
  if (ms === undefined) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WorkflowRuntimeError('Agent 执行超时')), ms);
  });
  try {
    return await Promise.race([promise, wait]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
