import {
  validateWorkflow,
  type AgentNode,
  type ConditionNode,
  type LoopNode,
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
  type WorkflowCheckpoint,
  type CheckpointStore,
} from './types.js';
import { AgentExecutionError, createDefaultAgentExecutor } from '../../agents/index.js';
import { evaluateLoopStopCondition, classifyLoopEdges } from './loop.js';
const defaultAgentExecutor = createDefaultAgentExecutor();

class NoOpCheckpointStore implements CheckpointStore {
  save(): void {}
}

export class WorkflowRuntime {
  private readonly agentExecutor: AgentExecutorLike;
  private readonly timeout?: number;
  private readonly retries: number;
  private readonly makeRunId: () => string;
  private readonly makeNodeRunId: (id: string, index: number) => string;
  private readonly checkpointStore: CheckpointStore;
  private readonly workflowTimeoutMs?: number;

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
    if (options.workflowTimeoutMs !== undefined && options.workflowTimeoutMs <= 0)
      throw new WorkflowRuntimeError('workflowTimeoutMs 必须是正数');
    this.agentExecutor = options.agentExecutor ?? defaultAgentExecutor;
    this.timeout = options.agentTimeoutMs;
    this.retries = options.maxAgentRetries ?? 0;
    this.makeRunId = options.runIdFactory ?? (() => 'run-' + Date.now());
    this.makeNodeRunId = options.nodeRunIdFactory ?? ((id, index) => id + '-run-' + (index + 1));
    this.checkpointStore = options.checkpointStore ?? new NoOpCheckpointStore();
    this.workflowTimeoutMs = options.workflowTimeoutMs;
  }

  run(options: WorkflowRunOptions = {}): Promise<WorkflowRunResult> {
    return this.execute(options);
  }

  async execute(options: WorkflowRunOptions = {}): Promise<WorkflowRunResult> {
    const startedAtMs = Date.now();
    const workflowDeadlineMs =
      this.workflowTimeoutMs === undefined ? undefined : startedAtMs + this.workflowTimeoutMs;
    const variables = clone({ ...this.workflow.variables, ...(options.variables ?? {}) });
    const nodeRuns: WorkflowNodeRun[] = [];
    const outputs: Record<string, JsonObject> = {};
    const iterations: Record<string, number> = {};
    const checkpoints: WorkflowCheckpoint[] = [];
    const result: WorkflowRunResult = {
      id: this.makeRunId(),
      workflowId: this.workflow.id,
      status: 'RUNNING',
      variables,
      nodeRuns,
      iterations,
      checkpoints,
      startedAt: new Date(startedAtMs).toISOString(),
    };
    let current = this.start();
    let lastOutput: JsonObject | undefined;
    let active: WorkflowNodeRun | undefined;
    try {
      for (let index = 0; ; index += 1) {
        checkAbort(options.signal);
        checkWorkflowTimeout(this.workflowTimeoutMs, startedAtMs, options.signal);
        if (current.type === 'loop') {
          const run: WorkflowNodeRun = {
            id: this.makeNodeRunId(current.id, index),
            nodeId: current.id,
            status: 'RUNNING',
            attempts: 0,
            startedAt: new Date().toISOString(),
            iteration: iterations[current.id] ?? 0,
          };
          nodeRuns.push(run);
          active = run;
          const loopResult = await this.loop(
            current,
            variables,
            outputs,
            iterations,
            nodeRuns,
            run,
            options.signal,
            index,
            startedAtMs,
            checkpoints,
            result.id,
          );
          run.attempts = loopResult.attempts;
          run.status = loopResult.status;
          run.iteration = iterations[current.id] ?? run.iteration;
          run.finishedAt = new Date().toISOString();
          active = undefined;
          if (loopResult.status === 'FAILED') {
            run.error = loopResult.error;
            run.errorCode = loopResult.errorCode;
            result.status = options.signal?.aborted ? 'CANCELLED' : 'FAILED';
            result.error = loopResult.error;
            result.errorCode = loopResult.errorCode;
            result.finishedAt = new Date().toISOString();
            return result;
          }
          if (loopResult.lastOutput) lastOutput = loopResult.lastOutput;
          current = loopResult.next!;
          continue;
        }
        const run: WorkflowNodeRun = {
          id: this.makeNodeRunId(current.id, index),
          nodeId: current.id,
          status: 'RUNNING',
          attempts: 0,
          startedAt: new Date().toISOString(),
          iteration: iterations[current.id],
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
          const output = await this.agent(
            current,
            input,
            variables,
            outputs,
            run,
            options.signal,
            workflowDeadlineMs,
            'WORKFLOW_TIMEOUT',
          );
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
        } else if (current.type === 'condition') {
          current = this.conditionNode(current, variables, outputs);
          run.attempts = 1;
        } else throw new WorkflowRuntimeError('暂不支持执行当前节点');
        run.finishedAt = new Date().toISOString();
        active = undefined;
      }
      result.status = 'SUCCESS';
      result.finishedAt = new Date().toISOString();
      return result;
    } catch (error) {
      return this.handleFail(error, active, result, options.signal);
    }
  }

  private async loop(
    node: LoopNode,
    variables: JsonObject,
    outputs: Record<string, JsonObject>,
    iterations: Record<string, number>,
    nodeRuns: WorkflowNodeRun[],
    run: WorkflowNodeRun,
    signal: AbortSignal | undefined,
    index: number,
    startedAtMs: number,
    checkpoints: WorkflowCheckpoint[],
    runId: string,
  ): Promise<LoopStepResult> {
    const maxIterations = node.config.maxIterations;
    const stopCondition = node.config.stopCondition;
    const maxLoopRetries = node.config.retry ?? 0;
    const loopTimeoutMs = node.config.timeout;
    const workflowDeadlineMs =
      this.workflowTimeoutMs === undefined ? undefined : startedAtMs + this.workflowTimeoutMs;
    const edges = this.workflow.edges.filter((edge) => edge.source === node.id);
    const routing = classifyLoopEdges(node, edges);
    if (!routing.body)
      throw new WorkflowRuntimeError('Loop 节点缺少 body 边：' + node.id, 'LOOP_CONFIG_ERROR');
    if (!routing.exit)
      throw new WorkflowRuntimeError('Loop 节点缺少 exit 边：' + node.id, 'LOOP_CONFIG_ERROR');
    const exitNode = this.node(routing.exit.target);
    const bodyStartNode = this.node(routing.body.target);
    const loopStartedAtMs = Date.now();
    const loopDeadlineMs =
      loopTimeoutMs === undefined ? undefined : loopStartedAtMs + loopTimeoutMs;
    const checkpointIndex = checkpoints.length;
    iterations[node.id] = 0;
    let lastOutput: JsonObject | undefined;
    let attemptCounter = 0;

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      checkAbort(signal);
      if (loopTimeoutMs !== undefined) {
        const elapsed = Date.now() - loopStartedAtMs;
        if (elapsed >= loopTimeoutMs)
          throw new WorkflowRuntimeError('Loop 执行超时', 'LOOP_TIMEOUT');
      }
      checkWorkflowTimeout(this.workflowTimeoutMs, startedAtMs, signal);
      iterations[node.id] = iteration;
      run.iteration = iteration;
      await this.persistCheckpoint(checkpoints, {
        id: 'cp-' + runId + '-' + checkpointIndex + '-' + iteration,
        runId,
        workflowId: this.workflow.id,
        currentNode: node.id,
        variables: clone(variables),
        nodeOutputs: cloneOutputs(outputs),
        iterations: { ...iterations },
        createdAt: new Date().toISOString(),
      });
      const iterationVariables = clone(variables);
      const iterationOutputs = cloneOutputs(outputs);
      const iterationLastOutput = lastOutput;
      let iterationError: unknown;
      for (let retry = 0; retry <= maxLoopRetries; retry += 1) {
        checkAbort(signal);
        attemptCounter += 1;
        try {
          const body = await this.executeBody(
            bodyStartNode,
            node.id,
            variables,
            outputs,
            iterations,
            nodeRuns,
            index + iteration * 100 + retry,
            signal,
            minDeadline(loopDeadlineMs, workflowDeadlineMs),
            deadlineCode(loopDeadlineMs, workflowDeadlineMs),
          );
          lastOutput = body.lastOutput;
          iterationError = undefined;
          break;
        } catch (error) {
          if (isExecutionControlError(error)) throw error;
          restoreJsonObject(variables, iterationVariables);
          restoreOutputs(outputs, iterationOutputs);
          lastOutput = iterationLastOutput;
          iterationError = error;
        }
      }
      if (iterationError) {
        if (iteration >= maxIterations) {
          const message =
            iterationError instanceof Error ? iterationError.message : String(iterationError);
          return {
            attempts: attemptCounter,
            status: 'FAILED',
            errorCode: 'MAX_ITERATIONS_REACHED',
            error: 'Loop 达到最大迭代次数：' + message,
            next: undefined,
            lastOutput,
          };
        }
        continue;
      }
      const state = { variables, nodeOutputs: outputs };
      const decision = evaluateLoopStopCondition(stopCondition, state);
      if (decision.error) {
        const message = 'stopCondition 执行失败: ' + decision.error;
        return {
          attempts: attemptCounter,
          status: 'FAILED',
          errorCode: 'LOOP_EVAL_ERROR',
          error: message,
          next: undefined,
          lastOutput,
        };
      }
      if (decision.stop) {
        await this.persistCheckpoint(checkpoints, {
          id: 'cp-' + runId + '-exit-' + iteration,
          runId,
          workflowId: this.workflow.id,
          currentNode: node.id,
          variables: clone(variables),
          nodeOutputs: cloneOutputs(outputs),
          iterations: { ...iterations },
          createdAt: new Date().toISOString(),
        });
        return { attempts: attemptCounter, status: 'SUCCESS', next: exitNode, lastOutput };
      }
    }
    return {
      attempts: attemptCounter,
      status: 'FAILED',
      errorCode: 'MAX_ITERATIONS_REACHED',
      error: 'Loop 达到最大迭代次数',
      next: undefined,
      lastOutput,
    };
  }

  private async executeBody(
    start: WorkflowNode,
    loopId: string,
    variables: JsonObject,
    outputs: Record<string, JsonObject>,
    iterations: Record<string, number>,
    nodeRuns: WorkflowNodeRun[],
    baseIndex: number,
    signal: AbortSignal | undefined,
    deadlineMs: number | undefined,
    deadlineCode: string,
  ): Promise<{ lastOutput: JsonObject | undefined }> {
    let current: WorkflowNode | undefined = start;
    let lastOutput: JsonObject | undefined;
    let localIndex = 0;
    const visited = new Set<string>();
    while (current) {
      checkAbort(signal);
      checkDeadline(deadlineMs, deadlineCode, signal);
      if (current.id === loopId) return { lastOutput };
      if (current.type === 'loop')
        throw new WorkflowRuntimeError('Phase 5 不支持嵌套 Loop', 'LOOP_NESTED');
      const runId2 = this.makeNodeRunId(current.id, baseIndex + localIndex);
      const run: WorkflowNodeRun = {
        id: runId2,
        nodeId: current.id,
        status: 'RUNNING',
        attempts: 0,
        startedAt: new Date().toISOString(),
        iteration: iterations[loopId],
      };
      nodeRuns.push(run);
      try {
        if (current.type === 'agent') {
          const input = inputOf(current as AgentNode, variables, outputs);
          run.input = input;
          const output = await this.agent(
            current as AgentNode,
            input,
            variables,
            outputs,
            run,
            signal,
            deadlineMs,
            deadlineCode,
          );
          run.output = output;
          outputs[current.id] = output;
          lastOutput = output;
          const key = current.outputKey ?? current.config.outputKey;
          if (key) variables[key] = output;
          current = this.next(current.id);
        } else if (current.type === 'condition') {
          current = this.conditionNode(current, variables, outputs);
          run.attempts = 1;
        } else if (current.type === 'start' || current.type === 'end') {
          throw new WorkflowRuntimeError(
            'Loop body 不允许出现 ' + current.type + ' 节点',
            'LOOP_BODY_ERROR',
          );
        } else throw new WorkflowRuntimeError('Loop body 不支持当前节点');
        run.status = 'SUCCESS';
        run.finishedAt = new Date().toISOString();
      } catch (error) {
        run.status = 'FAILED';
        run.error = error instanceof Error ? error.message : String(error);
        run.errorCode =
          error instanceof AgentExecutionError
            ? error.code
            : error instanceof WorkflowRuntimeError
              ? error.code
              : undefined;
        run.finishedAt = new Date().toISOString();
        throw error;
      }
      localIndex += 1;
      if (current && visited.has(current.id))
        throw new WorkflowRuntimeError('Loop body 出现循环回环：' + current.id, 'LOOP_BODY_CYCLE');
      if (current) visited.add(current.id);
    }
    return { lastOutput };
  }

  private start(): WorkflowNode {
    const node = this.workflow.nodes.find((item) => item.type === 'start');
    if (!node) throw new WorkflowRuntimeError('Workflow 缺少 Start 节点');
    return node;
  }

  private node(id: string): WorkflowNode {
    const node = this.workflow.nodes.find((item) => item.id === id);
    if (!node) throw new WorkflowRuntimeError('节点不存在：' + id);
    return node;
  }

  private next(id: string): WorkflowNode {
    const edges = this.workflow.edges.filter((edge) => edge.source === id);
    if (edges.length !== 1)
      throw new WorkflowRuntimeError(
        '节点 ' + id + ' 必须有且只有一条出边（在 body 之后），实际为 ' + edges.length,
      );
    return this.node(edges[0]!.target);
  }

  private async agent(
    node: AgentNode,
    input: JsonValue,
    variables: JsonObject,
    outputs: Readonly<Record<string, JsonObject>>,
    run: WorkflowNodeRun,
    signal?: AbortSignal,
    deadlineMs?: number,
    deadlineCode = 'WORKFLOW_TIMEOUT',
  ): Promise<JsonObject> {
    let last: unknown;
    for (let attempt = 1; attempt <= this.retries + 1; attempt += 1) {
      checkAbort(signal);
      run.attempts = attempt;
      const execution = createChildAbortController(signal);
      try {
        const context: AgentExecutionContext = {
          node,
          input,
          variables,
          nodeOutputs: outputs,
          signal: execution.signal,
        };
        const promise =
          typeof this.agentExecutor === 'function'
            ? this.agentExecutor(context)
            : this.agentExecutor.execute(context);
        const value = await waitForAgent(
          promise,
          this.timeout,
          signal,
          deadlineMs,
          deadlineCode,
          execution.controller,
        );
        if (!isObject(value.output)) throw new WorkflowRuntimeError('Agent 输出必须是对象');
        return clone(value.output);
      } catch (error) {
        if (isExecutionControlError(error)) throw error;
        last = error;
      } finally {
        execution.dispose();
      }
    }
    throw last instanceof Error ? last : new WorkflowRuntimeError('Agent 执行失败');
  }

  private conditionNode(
    node: ConditionNode,
    variables: JsonObject,
    outputs: Readonly<Record<string, JsonObject>>,
  ): WorkflowNode {
    const decision = evaluateLoopStopCondition(node.config.expression, {
      variables,
      nodeOutputs: outputs,
    });
    if (decision.error)
      throw new WorkflowRuntimeError(
        'Condition expression 执行失败: ' + decision.error,
        'CONDITION_EVAL_ERROR',
      );
    const edges = this.workflow.edges.filter((edge) => edge.source === node.id);
    const label = decision.stop ? 'true' : 'false';
    const edge =
      edges.find((item) => item.condition?.trim().toLowerCase() === label) ??
      edges[decision.stop ? 0 : 1];
    if (!edge) throw new WorkflowRuntimeError('Condition 缺少分支出边：' + node.id);
    return this.node(edge.target);
  }

  private handleFail(
    error: unknown,
    active: WorkflowNodeRun | undefined,
    result: WorkflowRunResult,
    signal?: AbortSignal,
  ): WorkflowRunResult {
    const message = error instanceof Error ? error.message : String(error);
    if (active?.status === 'RUNNING') {
      active.status = 'FAILED';
      active.error = message;
      active.errorCode =
        error instanceof AgentExecutionError
          ? error.code
          : error instanceof WorkflowRuntimeError
            ? error.code
            : undefined;
      active.finishedAt = new Date().toISOString();
    }
    result.status = signal?.aborted ? 'CANCELLED' : 'FAILED';
    result.error = message;
    result.errorCode =
      error instanceof AgentExecutionError
        ? error.code
        : error instanceof WorkflowRuntimeError
          ? error.code
          : undefined;
    result.finishedAt = new Date().toISOString();
    return result;
  }

  private async persistCheckpoint(
    target: WorkflowCheckpoint[],
    checkpoint: WorkflowCheckpoint,
  ): Promise<void> {
    try {
      await this.checkpointStore.save(checkpoint);
      target.push(checkpoint);
    } catch (error) {
      throw new WorkflowRuntimeError(
        'Checkpoint 保存失败: ' + (error instanceof Error ? error.message : String(error)),
        'CHECKPOINT_ERROR',
      );
    }
  }
}

export function createWorkflowRuntime(
  workflow: WorkflowDefinition,
  options: WorkflowRuntimeOptions = {},
): WorkflowRuntime {
  return new WorkflowRuntime(workflow, options);
}
interface LoopStepResult {
  attempts: number;
  status: 'SUCCESS' | 'FAILED';
  error?: string;
  errorCode?: string;
  next?: WorkflowNode;
  lastOutput?: JsonObject;
}
function inputOf(
  node: AgentNode,
  variables: JsonObject,
  outputs: Readonly<Record<string, JsonObject>>,
): JsonValue {
  if (node.input) return resolveInput(node.input, variables, outputs);
  if (typeof node.config.input === 'string')
    return resolveInput(node.config.input, variables, outputs);
  return variables;
}
function resolveInput(
  value: JsonValue,
  variables: JsonObject,
  outputs: Readonly<Record<string, JsonObject>>,
): JsonValue {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (exact?.[1]) return lookupInput(exact[1], variables, outputs) ?? value;
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) =>
      String(lookupInput(path, variables, outputs) ?? ''),
    );
  }
  if (Array.isArray(value)) return value.map((item) => resolveInput(item, variables, outputs));
  if (isObject(value)) {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value))
      if (item !== undefined) result[key] = resolveInput(item, variables, outputs);
    return result;
  }
  return value;
}
function lookupInput(
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
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WorkflowRuntimeError('Workflow 已取消', 'CANCELLED');
}
function checkWorkflowTimeout(
  timeoutMs: number | undefined,
  startedAtMs: number,
  signal?: AbortSignal,
): void {
  checkAbort(signal);
  if (timeoutMs !== undefined && Date.now() - startedAtMs >= timeoutMs)
    throw new WorkflowRuntimeError('Workflow 执行超时', 'WORKFLOW_TIMEOUT');
}
function clone(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
function cloneOutputs(value: Readonly<Record<string, JsonObject>>): Record<string, JsonObject> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonObject>;
}
function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function minDeadline(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}
function deadlineCode(
  loopDeadline: number | undefined,
  workflowDeadline: number | undefined,
): string {
  if (
    loopDeadline !== undefined &&
    (workflowDeadline === undefined || loopDeadline <= workflowDeadline)
  )
    return 'LOOP_TIMEOUT';
  return 'WORKFLOW_TIMEOUT';
}
function checkDeadline(deadlineMs: number | undefined, code: string, signal?: AbortSignal): void {
  checkAbort(signal);
  if (deadlineMs !== undefined && Date.now() >= deadlineMs)
    throw new WorkflowRuntimeError(
      code === 'LOOP_TIMEOUT' ? 'Loop 执行超时' : 'Workflow 执行超时',
      code,
    );
}
function isExecutionControlError(error: unknown): boolean {
  return (
    error instanceof WorkflowRuntimeError &&
    ['CANCELLED', 'WORKFLOW_TIMEOUT', 'LOOP_TIMEOUT'].includes(error.code)
  );
}
function restoreJsonObject(target: JsonObject, snapshot: JsonObject): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, clone(snapshot));
}
function restoreOutputs(
  target: Record<string, JsonObject>,
  snapshot: Record<string, JsonObject>,
): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, cloneOutputs(snapshot));
}
function waitForAgent<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  deadlineMs: number | undefined,
  deadlineErrorCode: string,
  controller: AbortController,
): Promise<T> {
  const waits: Promise<T>[] = [promise];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const control = new Promise<never>((_, reject) => {
    const rejectForAbort = () => {
      controller.abort();
      reject(new WorkflowRuntimeError('Workflow 已取消', 'CANCELLED'));
    };
    if (signal?.aborted) {
      rejectForAbort();
      return;
    }
    if (signal) {
      abortListener = rejectForAbort;
      signal.addEventListener('abort', abortListener, { once: true });
    }
    const deadlineDelay =
      deadlineMs === undefined ? undefined : Math.max(0, deadlineMs - Date.now());
    const delay =
      timeoutMs === undefined
        ? deadlineDelay
        : deadlineDelay === undefined
          ? timeoutMs
          : Math.min(timeoutMs, deadlineDelay);
    if (delay !== undefined) {
      const code =
        deadlineDelay !== undefined && deadlineDelay <= (timeoutMs ?? Number.POSITIVE_INFINITY)
          ? deadlineErrorCode
          : 'NODE_TIMEOUT';
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new WorkflowRuntimeError(
            code === 'NODE_TIMEOUT'
              ? 'Agent 执行超时'
              : code === 'LOOP_TIMEOUT'
                ? 'Loop 执行超时'
                : 'Workflow 执行超时',
            code,
          ),
        );
      }, delay);
    }
  });
  waits.push(control);
  return Promise.race(waits).finally(() => {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
  });
}

function createChildAbortController(parent?: AbortSignal): {
  controller: AbortController;
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (!parent) return { controller, signal: controller.signal, dispose: () => {} };
  const onAbort = () => controller.abort();
  if (parent.aborted) onAbort();
  else parent.addEventListener('abort', onAbort, { once: true });
  return {
    controller,
    signal: controller.signal,
    dispose: () => parent.removeEventListener('abort', onAbort),
  };
}
