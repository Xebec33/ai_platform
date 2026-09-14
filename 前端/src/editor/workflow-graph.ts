import { Position } from '@vue-flow/core';
import type { JsonObject, WorkflowInputDefinition } from '@ai-workflow/shared-types';
export const WORKFLOW_GRAPH_VERSION = 1 as const;
export const WORKFLOW_NODE_TYPES = ['start', 'agent', 'condition', 'tool', 'loop', 'end'] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];
export interface AgentOutputFieldConfig {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
}
export interface AgentNodeConfig {
  model: string;
  systemPrompt: string;
  outputFormat: 'text' | 'json';
  outputFields: AgentOutputFieldConfig[];
  temperature: number;
  maxTokens: number;
}
export interface ConditionNodeConfig {
  expression: string;
  parameter: string;
  relation: 'equals' | 'not_equals' | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal';
  comparisonValue: string;
  trueLabel: string;
  falseLabel: string;
}
export interface StartParameterConfig {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  value?: unknown;
  required?: boolean;
  description: string;
  system?: boolean;
}
export interface ToolNodeConfig {
  toolName: string;
  input: Record<string, unknown>;
  inputDescriptions: Record<string, string>;
  outputKey: string;
  outputKeyDescription: string;
}
export interface LoopNodeConfig {
  maxIterations: number;
  stopCondition: string;
  retry: number;
  timeout: number;
  bodyNodeId: string;
  exitNodeId: string;
}
export type WorkflowNodeConfig = Record<string, unknown>;
export interface WorkflowNodeData {
  label: string;
  config: WorkflowNodeConfig;
}
export interface WorkflowGraphNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}
export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}
export interface WorkflowGraph {
  id: string;
  name: string;
  version: typeof WORKFLOW_GRAPH_VERSION;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  variables: JsonObject;
  inputs: WorkflowInputDefinition[];
}
export type WorkflowGraphValidationCode =
  | 'INVALID_ROOT'
  | 'INVALID_VERSION'
  | 'MISSING_START'
  | 'MULTIPLE_START_NODES'
  | 'MISSING_END'
  | 'MULTIPLE_END_NODES'
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_EDGE_ID'
  | 'UNKNOWN_NODE_TYPE'
  | 'UNKNOWN_EDGE_SOURCE'
  | 'UNKNOWN_EDGE_TARGET';
export interface WorkflowGraphValidationIssue {
  code: WorkflowGraphValidationCode;
  message: string;
  path: string;
}
export interface WorkflowGraphValidationResult {
  valid: boolean;
  issues: WorkflowGraphValidationIssue[];
}
const agentConfig: AgentNodeConfig = {
  model: 'gpt-4o-mini',
  systemPrompt: 'You are a helpful workflow agent.',
  outputFormat: 'text',
  outputFields: [],
  temperature: 0.7,
  maxTokens: 2048,
};
const conditionConfig: ConditionNodeConfig = {
  expression: 'variables.approved === true',
  parameter: 'variables.approved',
  relation: 'equals',
  comparisonValue: 'true',
  trueLabel: '满足条件',
  falseLabel: '不满足条件',
};
const toolConfig: ToolNodeConfig = {
  toolName: 'file_read',
  input: { path: '' },
  inputDescriptions: { path: '工具输入参数的值或变量表达式。' },
  outputKey: '',
  outputKeyDescription: '工具输出写入的变量名称。',
};
const loopConfig: LoopNodeConfig = {
  maxIterations: 3,
  stopCondition: 'variables.review.passed == true',
  retry: 0,
  timeout: 0,
  bodyNodeId: '',
  exitNodeId: '',
};
export function createWorkflowGraphNode(
  type: WorkflowNodeType,
  id: string,
  position: { x: number; y: number },
): WorkflowGraphNode {
    const config =
    type === 'start'
      ? {
          inputParameters: [
            {
              name: 'inputs',
              type: 'string',
              required: true,
              system: true,
              description: '工作流总输入，由运行请求提供。',
            },
          ],
        }
      : type === 'agent'
      ? { ...agentConfig, outputFields: [] }
      : type === 'condition'
        ? { ...conditionConfig }
        : type === 'tool'
          ? {
              ...toolConfig,
              input: { ...toolConfig.input },
              inputDescriptions: { ...toolConfig.inputDescriptions },
            }
          : type === 'loop'
            ? { ...loopConfig }
            : {};
  return {
    id,
    type,
    position: { ...position },
    data: { label: type.charAt(0).toUpperCase() + type.slice(1), config },
  };
}
export function createDefaultWorkflowGraph(): WorkflowGraph {
  return {
    id: 'workflow-1',
    name: 'Untitled workflow',
    version: 1,
    variables: {},
    inputs: [],
    nodes: [
      createWorkflowGraphNode('start', 'start-1', { x: 80, y: 180 }),
      createWorkflowGraphNode('agent', 'agent-1', { x: 330, y: 180 }),
      createWorkflowGraphNode('end', 'end-1', { x: 620, y: 180 }),
    ],
    edges: [
      { id: 'edge-start-agent', source: 'start-1', target: 'agent-1' },
      { id: 'edge-agent-end', source: 'agent-1', target: 'end-1' },
    ],
  };
}
export function graphToVueFlow(graph: WorkflowGraph) {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { ...n.position },
      data: { label: n.data.label, config: { ...n.data.config } },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: true,
      deletable: n.type !== 'start' && n.type !== 'end',
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      label: e.label,
      data: e.label ? { label: e.label } : undefined,
      type: 'smoothstep',
      animated: false,
    })),
  };
}
export function vueFlowToGraph(
  nodes: readonly {
    id: string;
    type?: string;
    position: { x: number; y: number };
    data: WorkflowNodeData;
  }[],
  edges: readonly {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    label?: string;
  }[],
  metadata: Pick<WorkflowGraph, 'id' | 'name'> &
    Partial<Pick<WorkflowGraph, 'variables' | 'inputs'>> = {
    id: 'workflow-1',
    name: 'Untitled workflow',
  },
): WorkflowGraph {
  return {
    id: metadata.id,
    name: metadata.name,
    version: 1,
    variables: cloneJsonObject(metadata.variables ?? {}),
    inputs: cloneInputDefinitions(metadata.inputs ?? []),
    nodes: nodes.map((n) => ({
      id: n.id,
      type: isNodeType(n.type) ? n.type : 'agent',
      position: { ...n.position },
      data: { label: n.data.label, config: { ...n.data.config } },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      label: e.label,
    })),
  };
}
export function serializeWorkflowGraph(graph: WorkflowGraph): string {
  return JSON.stringify(graph, null, 2);
}
export function deserializeWorkflowGraph(value: string): WorkflowGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Workflow JSON 格式无效');
  }
  const graph = parseGraph(parsed);
  const result = validateWorkflowGraph(graph);
  if (!result.valid)
    throw new Error('Workflow Graph 无效：' + result.issues.map((i) => i.message).join('；'));
  return graph;
}

export function validateWorkflowGraph(value: unknown): WorkflowGraphValidationResult {
  const issues: WorkflowGraphValidationIssue[] = [];
  if (!isRecord(value))
    return {
      valid: false,
      issues: [{ code: 'INVALID_ROOT', message: 'Workflow Graph 必须是对象', path: '$' }],
    };
  if (value.version !== 1)
    issues.push({
      code: 'INVALID_VERSION',
      message: 'Workflow Graph version 必须为 1',
      path: '$.version',
    });
  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const edges = Array.isArray(value.edges) ? value.edges : [];
  const ids = new Set<string>();
  let starts = 0;
  let ends = 0;
  nodes.forEach((node, i) => {
    if (!isRecord(node)) {
      issues.push({ code: 'INVALID_ROOT', message: '节点必须是对象', path: '$.nodes[' + i + ']' });
      return;
    }
    const id = typeof node.id === 'string' ? node.id : '';
    if (id && ids.has(id))
      issues.push({
        code: 'DUPLICATE_NODE_ID',
        message: '节点 ID 重复：' + id,
        path: '$.nodes[' + i + '].id',
      });
    if (id) ids.add(id);
    if (!isNodeType(node.type))
      issues.push({
        code: 'UNKNOWN_NODE_TYPE',
        message: '不支持的节点类型：' + String(node.type),
        path: '$.nodes[' + i + '].type',
      });
    else if (node.type === 'start') starts++;
    else if (node.type === 'end') ends++;
  });
  if (!starts)
    issues.push({
      code: 'MISSING_START',
      message: 'Workflow Graph 至少需要一个 Start 节点',
      path: '$.nodes',
    });
  if (starts > 1)
    issues.push({
      code: 'MULTIPLE_START_NODES',
      message: 'Workflow Graph 只能有一个 Start 节点',
      path: '$.nodes',
    });
  if (!ends)
    issues.push({
      code: 'MISSING_END',
      message: 'Workflow Graph 至少需要一个 End 节点',
      path: '$.nodes',
    });
  if (ends > 1)
    issues.push({
      code: 'MULTIPLE_END_NODES',
      message: 'Workflow Graph 只能有一个 End 节点，所有分支必须汇聚到该节点',
      path: '$.nodes',
    });
  const edgeIds = new Set<string>();
  edges.forEach((edge, i) => {
    if (!isRecord(edge)) {
      issues.push({ code: 'INVALID_ROOT', message: '边必须是对象', path: '$.edges[' + i + ']' });
      return;
    }
    const id = typeof edge.id === 'string' ? edge.id : '';
    if (id && edgeIds.has(id))
      issues.push({
        code: 'DUPLICATE_EDGE_ID',
        message: '边 ID 重复：' + id,
        path: '$.edges[' + i + '].id',
      });
    if (id) edgeIds.add(id);
    const source = typeof edge.source === 'string' ? edge.source : '';
    const target = typeof edge.target === 'string' ? edge.target : '';
    if (!ids.has(source))
      issues.push({
        code: 'UNKNOWN_EDGE_SOURCE',
        message: '边的 source 节点不存在：' + source,
        path: '$.edges[' + i + '].source',
      });
    if (!ids.has(target))
      issues.push({
        code: 'UNKNOWN_EDGE_TARGET',
        message: '边的 target 节点不存在：' + target,
        path: '$.edges[' + i + '].target',
      });
  });
  return { valid: issues.length === 0, issues };
}
function parseGraph(value: unknown): WorkflowGraph {
  if (!isRecord(value)) throw new Error('Workflow JSON 根节点必须是对象');
  return {
    id: typeof value.id === 'string' ? value.id : '',
    name: typeof value.name === 'string' ? value.name : '',
    version: value.version === 1 ? 1 : (0 as never),
    variables: isRecord(value.variables) ? cloneJsonObject(value.variables) : {},
    inputs: Array.isArray(value.inputs) ? value.inputs.map(parseInput) : [],
    nodes: Array.isArray(value.nodes) ? value.nodes.map(parseNode) : [],
    edges: Array.isArray(value.edges) ? value.edges.map(parseEdge) : [],
  };
}
function parseNode(value: unknown, i: number): WorkflowGraphNode {
  if (!isRecord(value) || !isNodeType(value.type))
    throw new Error('Workflow JSON 节点 ' + i + ' 无效');
  const pos = isRecord(value.position) ? value.position : {};
  const data = isRecord(value.data) ? value.data : {};
  const config = isRecord(data.config) ? data.config : {};
  return {
    id: typeof value.id === 'string' ? value.id : '',
    type: value.type,
    position: {
      x: typeof pos.x === 'number' ? pos.x : 0,
      y: typeof pos.y === 'number' ? pos.y : 0,
    },
    data: {
      label:
        typeof data.label === 'string'
          ? data.label
          : value.type.charAt(0).toUpperCase() + value.type.slice(1),
      config: { ...config },
    },
  };
}
function parseInput(value: unknown, i: number): WorkflowInputDefinition {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.type !== 'string')
    throw new Error('Workflow JSON 输入变量 ' + i + ' 无效');
  return {
    name: value.name,
    type: value.type as WorkflowInputDefinition['type'],
    ...(typeof value.label === 'string' ? { label: value.label } : {}),
    ...(typeof value.required === 'boolean' ? { required: value.required } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(value.defaultValue !== undefined ? { defaultValue: value.defaultValue as never } : {}),
  };
}

function parseEdge(value: unknown, i: number): WorkflowGraphEdge {
  if (!isRecord(value)) throw new Error('Workflow JSON 边 ' + i + ' 无效');
  return {
    id: typeof value.id === 'string' ? value.id : '',
    source: typeof value.source === 'string' ? value.source : '',
    target: typeof value.target === 'string' ? value.target : '',
    ...(typeof value.sourceHandle === 'string' ? { sourceHandle: value.sourceHandle } : {}),
    ...(typeof value.targetHandle === 'string' ? { targetHandle: value.targetHandle } : {}),
    ...(typeof value.label === 'string' ? { label: value.label } : {}),
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function cloneJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
function cloneInputDefinitions(value: readonly WorkflowInputDefinition[]): WorkflowInputDefinition[] {
  return JSON.parse(JSON.stringify(value)) as WorkflowInputDefinition[];
}
function isNodeType(value: unknown): value is WorkflowNodeType {
  return typeof value === 'string' && (WORKFLOW_NODE_TYPES as readonly string[]).includes(value);
}
