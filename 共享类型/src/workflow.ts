export const WORKFLOW_DSL_VERSION = 1 as const;
export const WORKFLOW_NODE_TYPES = ['start', 'agent', 'condition', 'tool', 'loop', 'end'] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type WorkflowInputType = 'string' | 'number' | 'boolean' | 'object' | 'array';
export interface WorkflowInputDefinition extends JsonObject {
  name: string;
  label?: string;
  type: WorkflowInputType;
  required?: boolean;
  description?: string;
  defaultValue?: JsonValue;
}

export interface WorkflowParameterDefinition extends JsonObject {
  name: string;
  type: WorkflowInputType;
  required?: boolean;
  value?: JsonValue;
  description?: string;
  system?: boolean;
}

export interface StartConfig extends JsonObject {
  inputParameters: WorkflowParameterDefinition[];
  description?: string;
}

export interface AgentOutputField extends JsonObject {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
}
export interface AgentConfig extends JsonObject {
  model: string;
  systemPrompt: string;
  outputFormat?: 'text' | 'json';
  outputFields?: AgentOutputField[];
  mockOutput?: JsonObject;
  temperature?: number;
  maxTokens?: number;
  input?: JsonValue;
  outputKey?: string;
}
export interface ConditionConfig extends JsonObject {
  expression: string;
  parameter?: string;
  relation?: 'equals' | 'not_equals' | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal';
  comparisonValue?: JsonValue;
  trueLabel?: string;
  falseLabel?: string;
}
export interface ToolConfig extends JsonObject {
  toolName: string;
  input?: JsonObject;
  outputKey?: string;
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
export type StartNode = WorkflowNodeBase<'start', StartConfig>;
export type AgentNode = WorkflowNodeBase<'agent', AgentConfig>;
export type ConditionNode = WorkflowNodeBase<'condition', ConditionConfig>;
export type ToolNode = WorkflowNodeBase<'tool', ToolConfig>;
export type LoopNode = WorkflowNodeBase<'loop', LoopConfig>;
export type EndNode = WorkflowNodeBase<'end', Record<string, never>>;
export type WorkflowNode = StartNode | AgentNode | ConditionNode | ToolNode | LoopNode | EndNode;

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
  inputs?: WorkflowInputDefinition[];
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
  variables?: JsonObject;
  inputs?: WorkflowInputDefinition[];
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
      {
        id: 'start-1',
        type: 'start',
        name: 'Start',
        config: {
          inputParameters: [
            {
              name: 'inputs',
              type: 'string',
              required: true,
              system: true,
              description: '工作流总输入，由运行请求提供。',
            },
          ],
        },
      },
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
    inputs: [],
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
      if (type === 'condition') config.expression = conditionExpression(config);
      if (type === 'loop') applyLoopTargets(config, graph.edges, node.id);
      if (type === 'agent') {
        const outputSchema = outputSchemaFromAgentConfig(config);
        if (outputSchema) config.outputSchema = outputSchema;
        else delete config.outputSchema;
      }
      if (type === 'start') {
        return {
          id: node.id,
          type,
          name: node.data.label ?? type,
          config: normalizeStartConfig(config),
        } as WorkflowNode;
      }
      if (type === 'end')
        return { id: node.id, type, name: node.data.label ?? type, config: {} } as WorkflowNode;
      return { id: node.id, type, name: node.data.label ?? type, config } as WorkflowNode;
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle || edge.label ? { condition: edge.sourceHandle ?? edge.label } : {}),
    })),
    variables: cloneJsonObject(graph.variables ?? {}),
    inputs: startInputs(graph),
  };
}

function applyLoopTargets(
  config: Record<string, unknown>,
  edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null; label?: string }>,
  nodeId: string,
): void {
  for (const edge of edges) {
    if (edge.source !== nodeId) continue;
    const handle = edge.sourceHandle ?? edge.label;
    if (handle === 'body') config.bodyNodeId = edge.target;
    else if (handle === 'exit') config.exitNodeId = edge.target;
  }
}

function startInputs(graph: WorkflowUiGraph): WorkflowInputDefinition[] {
  const start = graph.nodes.find((node) => node.type === 'start');
  const parameters = start?.data.config?.inputParameters;
  if (!Array.isArray(parameters)) return cloneInputDefinitions(graph.inputs ?? []);
  return parameters
    .filter((parameter): parameter is WorkflowParameterDefinition =>
      typeof parameter === 'object' &&
      parameter !== null &&
      !Array.isArray(parameter) &&
      parameter.system !== true,
    )
    .map((parameter) => ({
      name: parameter.name,
      type: parameter.type,
      ...(typeof parameter.description === 'string' && parameter.description
        ? { description: parameter.description }
        : {}),
      ...(parameter.required !== undefined ? { required: parameter.required } : {}),
      ...(parameter.value !== undefined ? { defaultValue: parameter.value } : {}),
    }));
}

export function workflowToUiGraph(workflow: WorkflowDefinition): WorkflowUiGraph {
  const layers = computeLayers(workflow);
  const columnCounts = new Map<number, number>();
  return {
    id: workflow.id,
    name: workflow.name,
    nodes: workflow.nodes.map((node) => {
      const layer = layers.get(node.id) ?? 0;
      const row = columnCounts.get(layer) ?? 0;
      columnCounts.set(layer, row + 1);
      return {
        id: node.id,
        type: node.type,
        position: { x: 80 + layer * 280, y: 100 + row * 170 },
        data: { label: node.name, config: cloneJsonObject(node.config) as Record<string, unknown> },
      };
    }),
    edges: workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.condition ? { sourceHandle: edge.condition, label: edge.condition } : {}),
    })),
    variables: cloneJsonObject(workflow.variables),
    inputs: cloneInputDefinitions(workflow.inputs ?? []),
  };
}

function computeLayers(workflow: WorkflowDefinition): Map<string, number> {
  const layers = new Map<string, number>();
  const start = workflow.nodes.find((node) => node.type === 'start');
  if (!start) return layers;
  layers.set(start.id, 0);
  const queue: string[] = [start.id];
  while (queue.length) {
    const current = queue.shift() as string;
    const depth = layers.get(current) ?? 0;
    for (const edge of workflow.edges) {
      if (edge.source !== current) continue;
      if (layers.has(edge.target)) continue;
      layers.set(edge.target, depth + 1);
      queue.push(edge.target);
    }
  }
  const unplaced = workflow.nodes.filter((node) => !layers.has(node.id));
  if (unplaced.length) {
    const next = Math.max(0, ...layers.values()) + 1;
    for (const node of unplaced) layers.set(node.id, next);
  }
  return layers;
}

export function serializeWorkflow(workflow: WorkflowDefinition): string {
  return JSON.stringify(workflow, null, 2);
}

export function deserializeWorkflow(value: string): WorkflowDefinition {
  const parsed: unknown = JSON.parse(value);
  if (!isJsonObject(parsed)) throw new Error('Workflow DSL JSON 根节点必须是对象');
  return parsed as unknown as WorkflowDefinition;
}

export function conditionExpression(config: Record<string, unknown>): string {
  const parameter = typeof config.parameter === 'string' ? config.parameter.trim() : '';
  const relation = typeof config.relation === 'string' ? config.relation : 'equals';
  if (!parameter) return typeof config.expression === 'string' ? config.expression : '';
  const operator: Record<string, string> = {
    equals: '===',
    not_equals: '!==',
    greater_than: '>',
    greater_or_equal: '>=',
    less_than: '<',
    less_or_equal: '<=',
  };
  return `${parameter} ${operator[relation] ?? '==='} ${literal(config.comparisonValue)}`;
}

function normalizeStartConfig(config: Record<string, unknown>): StartConfig {
  const inputParameters = Array.isArray(config.inputParameters)
    ? config.inputParameters.filter((item): item is WorkflowParameterDefinition =>
        typeof item === 'object' && item !== null && !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).name === 'string' &&
        typeof (item as Record<string, unknown>).type === 'string',
      )
    : [];
  if (!inputParameters.some((parameter) => parameter.system && parameter.name === 'inputs')) {
    inputParameters.unshift({
      name: 'inputs',
      type: 'string',
      required: true,
      system: true,
      description: '工作流总输入，由运行请求提供。',
    });
  }
  return {
    inputParameters: inputParameters.map((parameter) => ({ ...parameter })),
    ...(typeof config.description === 'string' ? { description: config.description } : {}),
  };
}

function outputSchemaFromAgentConfig(config: Record<string, unknown>): JsonObject | undefined {
  if (config.outputFormat !== 'json') return undefined;
  const fields = Array.isArray(config.outputFields) ? config.outputFields : [];
  const properties: JsonObject = {};
  for (const field of fields) {
    if (typeof field !== 'object' || field === null || Array.isArray(field)) continue;
    const name = 'name' in field && typeof field.name === 'string' ? field.name.trim() : '';
    const type = 'type' in field && typeof field.type === 'string' ? field.type : 'string';
    if (name) properties[name] = { type };
  }
  return { type: 'object', properties };
}

function literal(value: unknown): string {
  if (value === undefined || value === '') return 'undefined';
  if (value === 'true' || value === true) return 'true';
  if (value === 'false' || value === false) return 'false';
  if (value === 'null' || value === null) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return value;
  return JSON.stringify(value);
}

function toWorkflowNodeType(type: string): WorkflowNodeType {
  if ((WORKFLOW_NODE_TYPES as readonly string[]).includes(type)) return type as WorkflowNodeType;
  throw new Error('不支持的 UI 节点类型：' + type);
}

function cloneJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function cloneInputDefinitions(value: readonly WorkflowInputDefinition[]): WorkflowInputDefinition[] {
  return JSON.parse(JSON.stringify(value)) as WorkflowInputDefinition[];
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
