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
  /** 允许该 Agent 在推理中调用已注册的 Tool（默认 false，纯 LLM 推理） */
  useTools?: boolean;
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
  /** 布线提示：汇聚边/回边从顶部或底部进入目标节点，避免与其他连线重合 */
  targetHandle?: 'top' | 'bottom';
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
  version?: 1;
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
          model: 'deepseek-chat',
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
      if (type === 'loop') {
        applyLoopTargets(config, graph.edges, node.id);
        if (typeof config.timeout === 'number' && config.timeout <= 0) delete config.timeout;
      }
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
  const rows = computeRows(workflow, layers);
  return {
    id: workflow.id,
    name: workflow.name,
    version: 1 as const,
    nodes: workflow.nodes.map((node) => {
      const layer = layers.get(node.id) ?? 0;
      const row = rows.get(node.id) ?? 0;
      return {
        id: node.id,
        type: node.type,
        position: { x: 80 + layer * 280, y: 100 + row * 180 },
        data: { label: node.name, config: cloneJsonObject(node.config) as Record<string, unknown> },
      };
    }),
    edges: workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.condition ? { sourceHandle: edge.condition, label: edge.condition } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
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
  // DFS 标记回边（环），随后在无环边集上做 Kahn 拓扑松弛：
  // 节点层级取最长路径深度，保证排在所有前驱的右侧
  const backEdges = new Set<number>();
  const state = new Map<string, 'visiting' | 'done'>();
  const mark = (id: string): void => {
    state.set(id, 'visiting');
    for (const [index, edge] of workflow.edges.entries()) {
      if (edge.source !== id || !layers.has(edge.target)) continue;
      if (state.get(edge.target) === 'visiting') backEdges.add(index);
      else if (!state.has(edge.target)) mark(edge.target);
    }
    state.set(id, 'done');
  };
  mark(start.id);
  const placedEdges = workflow.edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge, index }) => layers.has(edge.source) && layers.has(edge.target) && !backEdges.has(index));
  const inDegree = new Map<string, number>();
  for (const { edge } of placedEdges) inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  const ready = [...layers.keys()].filter((id) => !inDegree.get(id));
  while (ready.length) {
    const current = ready.shift() as string;
    const depth = layers.get(current) as number;
    for (const { edge } of placedEdges) {
      if (edge.source !== current) continue;
      if ((layers.get(edge.target) as number) < depth + 1) layers.set(edge.target, depth + 1);
      const remaining = (inDegree.get(edge.target) as number) - 1;
      inDegree.set(edge.target, remaining);
      if (remaining === 0) ready.push(edge.target);
    }
  }
  const unplaced = workflow.nodes.filter((node) => !layers.has(node.id));
  if (unplaced.length) {
    const next = Math.max(0, ...layers.values()) + 1;
    for (const node of unplaced) layers.set(node.id, next);
  }
  return layers;
}

function forwardEdges(workflow: WorkflowDefinition, layers: Map<string, number>) {
  return workflow.edges.filter((edge) => {
    const source = layers.get(edge.source);
    const target = layers.get(edge.target);
    return source !== undefined && target !== undefined && target > source;
  });
}

function computeRows(workflow: WorkflowDefinition, layers: Map<string, number>): Map<string, number> {
  const rows = new Map<string, number>();
  if (!layers.size) return rows;
  const children = new Map<string, string[]>();
  for (const edge of forwardEdges(workflow, layers)) {
    const list = children.get(edge.source) ?? [];
    if (!list.includes(edge.target)) list.push(edge.target);
    children.set(edge.source, list);
  }
  const declaration = new Map(workflow.nodes.map((node, index) => [node.id, index] as const));
  let cursor = 0;
  const visit = (id: string): number => {
    const existing = rows.get(id);
    if (existing !== undefined) return existing;
    const kids = children.get(id) ?? [];
    if (!kids.length) {
      rows.set(id, cursor);
      cursor += 1;
      return cursor - 1;
    }
    const childRows = kids.map(visit);
    const row = Math.floor(childRows.reduce((sum, value) => sum + value, 0) / childRows.length);
    rows.set(id, row);
    return row;
  };
  const start = workflow.nodes.find((node) => node.type === 'start' && layers.has(node.id));
  if (start) visit(start.id);
  for (const node of workflow.nodes) visit(node.id);

  // 自底向上：父节点行号取子节点行号均值，同层冲突时向下挤压
  const byLayer = new Map<number, WorkflowNode[]>();
  for (const node of workflow.nodes) {
    const layer = layers.get(node.id) ?? 0;
    const list = byLayer.get(layer) ?? [];
    list.push(node);
    byLayer.set(layer, list);
  }
  const finalRows = new Map<string, number>(rows);
  for (const layer of [...byLayer.keys()].sort((a, b) => b - a)) {
    const nodes = byLayer.get(layer) as WorkflowNode[];
    const desired = new Map<string, number>();
    for (const node of nodes) {
      const kids = children.get(node.id) ?? [];
      const row = kids.length
        ? Math.floor(kids.reduce((sum, kid) => sum + (finalRows.get(kid) ?? 0), 0) / kids.length)
        : (finalRows.get(node.id) ?? 0);
      desired.set(node.id, row);
    }
    const sorted = [...nodes].sort(
      (a, b) =>
        (desired.get(a.id) ?? 0) - (desired.get(b.id) ?? 0) ||
        (declaration.get(a.id) ?? 0) - (declaration.get(b.id) ?? 0),
    );
    let last = -1;
    for (const node of sorted) {
      const row = Math.max(desired.get(node.id) ?? 0, last + 1);
      finalRows.set(node.id, row);
      last = row;
    }
  }
  return finalRows;
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
    const description =
      'description' in field && typeof field.description === 'string' && field.description.trim()
        ? field.description.trim()
        : '';
    if (name)
      properties[name] = { type, ...(description ? { description } : {}) } as JsonObject;
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
