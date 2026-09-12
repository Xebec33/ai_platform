export const WORKFLOW_DSL_VERSION = 1 as const;
export const WORKFLOW_NODE_TYPES = ['start', 'agent', 'condition', 'loop', 'end'] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export interface AgentConfig extends JsonObject {
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  input?: string;
  outputKey?: string;
}
export interface ConditionConfig extends JsonObject {
  expression: string;
  trueLabel?: string;
  falseLabel?: string;
}
export interface LoopConfig extends JsonObject {
  maxIterations: number;
  stopCondition: string;
  retry?: number;
  timeout?: number;
  bodyNodeId?: string;
  exitNodeId?: string;
}
export type WorkflowNodeConfig = JsonObject;

export interface WorkflowNodeBase<
  T extends WorkflowNodeType,
  C extends WorkflowNodeConfig = WorkflowNodeConfig,
> {
  id: string;
  type: T;
  name: string;
  config: C;
  input?: JsonObject;
  outputKey?: string;
}
export type StartNode = WorkflowNodeBase<'start', Record<string, never>>;
export type AgentNode = WorkflowNodeBase<'agent', AgentConfig>;
export type ConditionNode = WorkflowNodeBase<'condition', ConditionConfig>;
export type LoopNode = WorkflowNodeBase<'loop', LoopConfig>;
export type EndNode = WorkflowNodeBase<'end', Record<string, never>>;
export type WorkflowNode = StartNode | AgentNode | ConditionNode | LoopNode | EndNode;

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}
export interface WorkflowDefinition {
  id: string;
  name: string;
  version: typeof WORKFLOW_DSL_VERSION;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: JsonObject;
}
export type Workflow = WorkflowDefinition;

export interface WorkflowUiNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { label?: string; config?: Record<string, unknown> };
}
export interface WorkflowUiEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}
export interface WorkflowUiGraph {
  id?: string;
  name?: string;
  nodes: WorkflowUiNode[];
  edges: WorkflowUiEdge[];
}

export function createWorkflowDefinition(
  id = 'workflow-1',
  name = 'Untitled workflow',
): WorkflowDefinition {
  return {
    id,
    name,
    version: WORKFLOW_DSL_VERSION,
    nodes: [
      { id: 'start-1', type: 'start', name: 'Start', config: {} },
      {
        id: 'agent-1',
        type: 'agent',
        name: 'Agent',
        config: {
          model: 'gpt-4o-mini',
          systemPrompt: 'You are a helpful workflow agent.',
          temperature: 0.7,
          maxTokens: 2048,
        },
      },
      { id: 'end-1', type: 'end', name: 'End', config: {} },
    ],
    edges: [
      { id: 'edge-start-agent', source: 'start-1', target: 'agent-1' },
      { id: 'edge-agent-end', source: 'agent-1', target: 'end-1' },
    ],
    variables: {},
  };
}

export function uiGraphToWorkflow(
  graph: WorkflowUiGraph,
  metadata: { id?: string; name?: string } = {},
): WorkflowDefinition {
  return {
    id: metadata.id ?? graph.id ?? 'workflow-1',
    name: metadata.name ?? graph.name ?? 'Untitled workflow',
    version: WORKFLOW_DSL_VERSION,
    nodes: graph.nodes.map((node) => {
      const type = toWorkflowNodeType(node.type);
      const config = cloneJsonObject(node.data.config ?? {});
      if (type === 'start' || type === 'end')
        return { id: node.id, type, name: node.data.label ?? type, config: {} } as WorkflowNode;
      return { id: node.id, type, name: node.data.label ?? type, config } as WorkflowNode;
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle || edge.label ? { condition: edge.sourceHandle ?? edge.label } : {}),
    })),
    variables: {},
  };
}

export function workflowToUiGraph(workflow: WorkflowDefinition): WorkflowUiGraph {
  return {
    id: workflow.id,
    name: workflow.name,
    nodes: workflow.nodes.map((node, index) => ({
      id: node.id,
      type: node.type,
      position: { x: 80 + (index % 3) * 260, y: 120 + Math.floor(index / 3) * 180 },
      data: { label: node.name, config: cloneJsonObject(node.config) as Record<string, unknown> },
    })),
    edges: workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.condition ? { sourceHandle: edge.condition, label: edge.condition } : {}),
    })),
  };
}

export function serializeWorkflow(workflow: WorkflowDefinition): string {
  return JSON.stringify(workflow, null, 2);
}

export function deserializeWorkflow(value: string): WorkflowDefinition {
  const parsed: unknown = JSON.parse(value);
  if (!isJsonObject(parsed)) throw new Error('Workflow DSL JSON 根节点必须是对象');
  return parsed as unknown as WorkflowDefinition;
}

function toWorkflowNodeType(type: string): WorkflowNodeType {
  if ((WORKFLOW_NODE_TYPES as readonly string[]).includes(type)) return type as WorkflowNodeType;
  throw new Error('不支持的 UI 节点类型：' + type);
}

function cloneJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
