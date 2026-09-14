import {
  WORKFLOW_DSL_VERSION,
  WORKFLOW_NODE_TYPES,
  type AgentConfig,
  type ConditionConfig,
  type ToolConfig,
  type WorkflowInputDefinition,
  type JsonObject,
  type LoopConfig,
  type WorkflowDefinition,
  type WorkflowNode,
} from './workflow.js';

export type ValidationCode =
  | 'INVALID_ROOT'
  | 'INVALID_VERSION'
  | 'INVALID_ID'
  | 'INVALID_NAME'
  | 'INVALID_NODES'
  | 'INVALID_EDGES'
  | 'INVALID_VARIABLES'
  | 'INVALID_INPUTS'
  | 'INVALID_INPUT_DEFINITION'
  | 'MISSING_START'
  | 'MULTIPLE_START'
  | 'MISSING_END'
  | 'MULTIPLE_END'
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_EDGE_ID'
  | 'UNKNOWN_NODE_TYPE'
  | 'UNKNOWN_EDGE_SOURCE'
  | 'UNKNOWN_EDGE_TARGET'
  | 'INVALID_NODE_CONFIG'
  | 'INVALID_AGENT_CONFIG'
  | 'INVALID_CONDITION_CONFIG'
  | 'INVALID_TOOL_CONFIG'
  | 'INVALID_LOOP_CONFIG'
  | 'UNREACHABLE_NODE'
  | 'UNTERMINATED_NODE'
  | 'SELF_LOOP';
export interface ValidationIssue {
  code: ValidationCode;
  message: string;
  path: string;
}
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function validateWorkflow(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value))
    return {
      valid: false,
      issues: [{ code: 'INVALID_ROOT', message: 'Workflow 必须是对象', path: '$' }],
    };
  const workflow = value as Partial<WorkflowDefinition>;
  if (workflow.version !== WORKFLOW_DSL_VERSION)
    add(issues, 'INVALID_VERSION', 'version 必须为 1', '$.version');
  if (!nonEmpty(workflow.id)) add(issues, 'INVALID_ID', 'id 不能为空', '$.id');
  if (!nonEmpty(workflow.name)) add(issues, 'INVALID_NAME', 'name 不能为空', '$.name');
  if (!Array.isArray(workflow.nodes)) add(issues, 'INVALID_NODES', 'nodes 必须是数组', '$.nodes');
  if (!Array.isArray(workflow.edges)) add(issues, 'INVALID_EDGES', 'edges 必须是数组', '$.edges');
  if (!isRecord(workflow.variables))
    add(issues, 'INVALID_VARIABLES', 'variables 必须是对象', '$.variables');
  validateInputs(workflow.inputs, issues);
  if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) return result(issues);
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  let starts = 0;
  let ends = 0;
  workflow.nodes.forEach((node, index) => {
    const path = '$.nodes[' + index + ']';
    if (!isRecord(node)) {
      add(issues, 'INVALID_NODE_CONFIG', '节点必须是对象', path);
      return;
    }
    const id = text(node.id);
    if (!id) add(issues, 'INVALID_NODE_CONFIG', '节点 id 不能为空', path + '.id');
    if (id && nodeIds.has(id))
      add(issues, 'DUPLICATE_NODE_ID', '节点 ID 重复：' + id, path + '.id');
    if (id) nodeIds.add(id);
    if (!nodeType(node.type)) {
      add(issues, 'UNKNOWN_NODE_TYPE', '不支持的节点类型：' + String(node.type), path + '.type');
      return;
    }
    if (node.type === 'start') starts += 1;
    if (node.type === 'end') ends += 1;
    validateConfig(node as unknown as WorkflowNode, path + '.config', issues);
  });
  if (starts === 0) add(issues, 'MISSING_START', 'Workflow 至少需要一个 Start 节点', '$.nodes');
  if (starts > 1) add(issues, 'MULTIPLE_START', 'Workflow 只能有一个 Start 节点', '$.nodes');
  if (ends === 0) add(issues, 'MISSING_END', 'Workflow 至少需要一个 End 节点', '$.nodes');
  if (ends > 1) add(issues, 'MULTIPLE_END', 'Workflow 只能有一个 End 节点，所有分支必须汇聚到该节点', '$.nodes');

  workflow.edges.forEach((edge, index) => {
    const path = '$.edges[' + index + ']';
    if (!isRecord(edge)) {
      add(issues, 'INVALID_EDGES', '边必须是对象', path);
      return;
    }
    const id = text(edge.id);
    const source = text(edge.source);
    const target = text(edge.target);
    if (!id) add(issues, 'INVALID_EDGES', '边 id 不能为空', path + '.id');
    if (id && edgeIds.has(id)) add(issues, 'DUPLICATE_EDGE_ID', '边 ID 重复：' + id, path + '.id');
    if (id) edgeIds.add(id);
    if (!nodeIds.has(source))
      add(issues, 'UNKNOWN_EDGE_SOURCE', '边的 source 节点不存在：' + source, path + '.source');
    if (!nodeIds.has(target))
      add(issues, 'UNKNOWN_EDGE_TARGET', '边的 target 节点不存在：' + target, path + '.target');
    if (source && source === target)
      add(issues, 'SELF_LOOP', '边不能连接节点自身：' + source, path);
    if (nodeIds.has(source) && nodeIds.has(target)) {
      outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
      incoming.set(target, [...(incoming.get(target) ?? []), source]);
    }
  });
  workflow.nodes.forEach((node, index) => {
    if (!isRecord(node) || node.type !== 'loop') return;
    const path = '$.nodes[' + index + '].config';
    if (!isRecord(node.config)) {
      add(issues, 'INVALID_LOOP_CONFIG', 'Loop config 必须是对象', path);
      return;
    }
    const config = node.config;
    const edges = workflow.edges!.filter(
      (edge) => isRecord(edge) && text(edge.source) === text(node.id),
    );
    const bodyId = nonEmpty(config.bodyNodeId) ? config.bodyNodeId : undefined;
    const exitId = nonEmpty(config.exitNodeId) ? config.exitNodeId : undefined;
    const bodyEdge = bodyId
      ? edges.find((edge) => text(edge.target) === bodyId)
      : (edges.find((edge) => isLoopBodyLabel(text(edge.condition))) ?? edges[0]);
    const exitEdge = exitId
      ? edges.find((edge) => text(edge.target) === exitId)
      : (edges.find((edge) => isLoopExitLabel(text(edge.condition))) ??
        (edges.length > 1 ? edges.at(-1) : undefined));
    if (!bodyEdge || !exitEdge || bodyEdge === exitEdge)
      add(issues, 'INVALID_LOOP_CONFIG', 'Loop 必须配置两条不同的 body 和 exit 出边', path);
  });
  if (starts === 1) {
    const start = workflow.nodes.find((node) => isRecord(node) && node.type === 'start');
    const reachable = walk(text(start && start.id), outgoing);
    workflow.nodes.forEach((node, index) => {
      if (isRecord(node) && typeof node.id === 'string' && !reachable.has(node.id))
        add(
          issues,
          'UNREACHABLE_NODE',
          '节点不可从 Start 到达：' + node.id,
          '$.nodes[' + index + ']',
        );
    });
  }
  if (ends > 0) {
    const endIds = new Set(
      workflow.nodes
        .filter((node) => isRecord(node) && node.type === 'end')
        .map((node) => text(node.id)),
    );
    const canEnd = reverseWalk(endIds, incoming);
    workflow.nodes.forEach((node, index) => {
      if (isRecord(node) && typeof node.id === 'string' && !canEnd.has(node.id))
        add(issues, 'UNTERMINATED_NODE', '节点无法到达 End：' + node.id, '$.nodes[' + index + ']');
    });
  }
  return result(issues);
}

function validateInputs(value: unknown, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    add(issues, 'INVALID_INPUTS', 'inputs 必须是数组', '$.inputs');
    return;
  }
  const names = new Set<string>();
  value.forEach((item, index) => {
    const path = '$.inputs[' + index + ']';
    if (!isRecord(item)) {
      add(issues, 'INVALID_INPUT_DEFINITION', '输入变量定义必须是对象', path);
      return;
    }
    const input = item as WorkflowInputDefinition;
    if (!nonEmpty(input.name) || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(input.name))
      add(issues, 'INVALID_INPUT_DEFINITION', '输入变量 name 必须是合法标识符', path + '.name');
    if (names.has(input.name))
      add(issues, 'INVALID_INPUT_DEFINITION', '输入变量 name 重复：' + input.name, path + '.name');
    names.add(input.name);
    if (!['string', 'number', 'boolean', 'object', 'array'].includes(input.type))
      add(issues, 'INVALID_INPUT_DEFINITION', '输入变量 type 不受支持', path + '.type');
    if (input.required !== undefined && typeof input.required !== 'boolean')
      add(issues, 'INVALID_INPUT_DEFINITION', '输入变量 required 必须是布尔值', path + '.required');
  });
}

function validateConfig(node: WorkflowNode, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(node.config)) {
    add(issues, 'INVALID_NODE_CONFIG', 'config 必须是对象', path);
    if (node.type === 'loop') add(issues, 'INVALID_LOOP_CONFIG', 'Loop config 必须是对象', path);
    return;
  }
  if (node.type === 'start') {
    const parameters = (node.config as { inputParameters?: unknown }).inputParameters;
    if (!Array.isArray(parameters))
      add(issues, 'INVALID_NODE_CONFIG', 'Start 必须配置 inputParameters 参数列表', path);
    else if (!parameters.some((item) => isRecord(item) && item.name === 'inputs' && item.system === true))
      add(issues, 'INVALID_NODE_CONFIG', 'Start 必须包含系统参数 inputs（必填 string）', path);
  }
  if (node.type === 'agent') {
    const config = node.config as AgentConfig;
    if (!nonEmpty(config.model) || !nonEmpty(config.systemPrompt))
      add(issues, 'INVALID_AGENT_CONFIG', 'Agent 必须配置非空 model 和 systemPrompt', path);
    if (
      config.temperature !== undefined &&
      (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2)
    )
      add(issues, 'INVALID_AGENT_CONFIG', 'temperature 必须在 0 到 2 之间', path);
    if (
      config.maxTokens !== undefined &&
      (!Number.isInteger(config.maxTokens) || config.maxTokens <= 0)
    )
      add(issues, 'INVALID_AGENT_CONFIG', 'maxTokens 必须是正整数', path);
    if (config.outputFormat !== undefined && config.outputFormat !== 'text' && config.outputFormat !== 'json')
      add(issues, 'INVALID_AGENT_CONFIG', 'outputFormat 必须是 text 或 json', path);
    if (config.outputFields !== undefined && !Array.isArray(config.outputFields))
      add(issues, 'INVALID_AGENT_CONFIG', 'outputFields 必须是数组', path);
  }
  if (node.type === 'condition' && !nonEmpty((node.config as ConditionConfig).expression))
    add(issues, 'INVALID_CONDITION_CONFIG', 'Condition 必须配置非空 expression', path);
  if (node.type === 'tool') {
    const config = node.config as ToolConfig;
    if (!nonEmpty(config.toolName)) add(issues, 'INVALID_TOOL_CONFIG', 'Tool 必须配置 toolName', path);
    if (config.input !== undefined && !isRecord(config.input))
      add(issues, 'INVALID_TOOL_CONFIG', 'Tool input 必须是对象', path);
  }
  if (node.type === 'loop') {
    const config = node.config as LoopConfig;
    if (
      !Number.isInteger(config.maxIterations) ||
      config.maxIterations <= 0 ||
      !nonEmpty(config.stopCondition)
    )
      add(
        issues,
        'INVALID_LOOP_CONFIG',
        'Loop 必须配置正整数 maxIterations 和非空 stopCondition',
        path,
      );
    if (config.retry !== undefined && (!Number.isInteger(config.retry) || config.retry < 0))
      add(issues, 'INVALID_LOOP_CONFIG', 'retry 必须是非负整数', path);
    if (config.timeout !== undefined && (typeof config.timeout !== 'number' || config.timeout <= 0))
      add(issues, 'INVALID_LOOP_CONFIG', 'timeout 必须是正数', path);
    if (config.bodyNodeId !== undefined && !nonEmpty(config.bodyNodeId))
      add(issues, 'INVALID_LOOP_CONFIG', 'bodyNodeId 必须是非空字符串', path);
    if (config.exitNodeId !== undefined && !nonEmpty(config.exitNodeId))
      add(issues, 'INVALID_LOOP_CONFIG', 'exitNodeId 必须是非空字符串', path);
  }
}

function walk(start: string, graph: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    queue.push(...(graph.get(node) ?? []));
  }
  return seen;
}
function reverseWalk(starts: Set<string>, graph: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    queue.push(...(graph.get(node) ?? []));
  }
  return seen;
}
function nodeType(value: unknown): value is WorkflowNode['type'] {
  return typeof value === 'string' && (WORKFLOW_NODE_TYPES as readonly string[]).includes(value);
}
function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function add(issues: ValidationIssue[], code: ValidationCode, message: string, path: string): void {
  issues.push({ code, message, path });
}
function result(issues: ValidationIssue[]): ValidationResult {
  return { valid: issues.length === 0, issues };
}

function isLoopBodyLabel(value: string): boolean {
  return ['continue', 'body', 'retry', 'false'].includes(value.trim().toLowerCase());
}
function isLoopExitLabel(value: string): boolean {
  return ['stop', 'exit', 'done', 'success', 'true'].includes(value.trim().toLowerCase());
}
