import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import type { JsonObject } from '@ai-workflow/shared-types';
import { uiGraphToWorkflow } from '@ai-workflow/shared-types';
import { saveWorkflow } from '../api/workflows';
import {
  createDefaultWorkflowGraph,
  createWorkflowGraphNode,
  deserializeWorkflowGraph,
  graphToVueFlow,
  serializeWorkflowGraph,
  validateWorkflowGraph,
  vueFlowToGraph,
  type WorkflowGraph,
  type WorkflowNodeType,
} from '../editor/workflow-graph';

const STORAGE_KEY = 'ai-workflow-platform:workflow-graph';
const AUTOSAVE_DELAY_MS = 250;
type Flow = ReturnType<typeof graphToVueFlow>;
  type EditorInput = {
  name: string;
  label?: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description?: string;
  defaultValue?: unknown;
};
  type StartParameter = {
    name: string;
    type: EditorInput['type'];
    value?: unknown;
    required?: boolean;
    description: string;
    system?: boolean;
  };

export const useWorkflowEditorStore = defineStore('workflow-editor', () => {
  const initial = graphToVueFlow(createDefaultWorkflowGraph());
  const workflowId = ref('workflow-1');
  const storeVariables = ref<JsonObject>({});
  const storeInputs = ref<EditorInput[]>([]);
  const inputValues = ref<JsonObject>({});
  const workflowName = ref('Untitled workflow');
  const nodes = ref<Flow['nodes']>(initial.nodes);
  const edges = ref<Flow['edges']>(initial.edges);
  const selectedNodeId = ref<string | null>(null);
  const message = ref('');
  const error = ref('');
  const savedAt = ref<string | null>(null);
  const autosavePending = ref(false);
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  const selectedNode = computed(
    () => nodes.value.find((node) => node.id === selectedNodeId.value) ?? null,
  );
  const graph = computed<WorkflowGraph>(() => {
    const convert = vueFlowToGraph as unknown as (...args: never[]) => WorkflowGraph;
    return convert(nodes.value as never, edges.value as never, {
      id: workflowId.value,
      name: workflowName.value,
      variables: storeVariables.value,
      inputs: storeInputs.value as never,
    } as never);
  });
  const validation = computed(() => validateWorkflowGraph(graph.value));
  watch(
    [nodes, edges, workflowId, workflowName],
    () => scheduleAutosave(),
    { deep: true },
  );
  function applyGraph(next: WorkflowGraph): void {
    const flow = graphToVueFlow(next);
    workflowId.value = next.id;
    workflowName.value = next.name;
    storeVariables.value = { ...next.variables };
    storeInputs.value = next.inputs.map((input) => ({ ...input }));
    const defaults: JsonObject = {};
    for (const input of storeInputs.value) {
      if (input.defaultValue !== undefined) defaults[input.name] = input.defaultValue as never;
    }
    inputValues.value = defaults;
    nodes.value = flow.nodes;
    edges.value = flow.edges;
    selectedNodeId.value = null;
  }
  function initialize(): boolean {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      scheduleAutosave();
      return false;
    }
    try {
      applyGraph(deserializeWorkflowGraph(stored));
      savedAt.value = new Date().toLocaleTimeString();
      message.value = '已从本地存储恢复 Workflow';
      return true;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '本地 Workflow 无法加载';
      return false;
    }
  }
  function scheduleAutosave(): void {
    autosavePending.value = true;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = undefined;
      save(true);
    }, AUTOSAVE_DELAY_MS);
  }
  function replaceNodes(next: Flow['nodes']): void {
    const ids = new Set(next.map((node) => node.id));
    nodes.value = next;
    edges.value = edges.value.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    if (selectedNodeId.value && !ids.has(selectedNodeId.value)) selectedNodeId.value = null;
    scheduleAutosave();
  }
  function replaceEdges(next: Flow['edges']): void {
    edges.value = next;
    scheduleAutosave();
  }
  function nextId(type: WorkflowNodeType): string {
    let index = 1;
    while (nodes.value.some((node) => node.id === type + '-' + index)) index += 1;
    return type + '-' + index;
  }
  function addNode(type: WorkflowNodeType): void {
    if (type === 'start' && nodes.value.some((node) => node.type === 'start')) return;
    if (type === 'end' && nodes.value.some((node) => node.type === 'end')) return;
    const node = createWorkflowGraphNode(type, nextId(type), {
      x: 160 + (nodes.value.length % 3) * 240,
      y: 100 + Math.floor(nodes.value.length / 3) * 150,
    });
    const flow = graphToVueFlow({
      id: workflowId.value,
      name: workflowName.value,
      version: 1,
      variables: storeVariables.value,
      inputs: storeInputs.value as never,
      nodes: [node],
      edges: [],
    });
    const created = flow.nodes[0];
    if (!created) return;
    nodes.value = [...nodes.value, created];
    selectedNodeId.value = node.id;
    scheduleAutosave();
  }
  function selectNode(id: string | null): void {
    selectedNodeId.value = id;
  }
  function updateSelectedLabel(label: string): void {
    if (selectedNode.value) {
      selectedNode.value.data.label = label;
      scheduleAutosave();
    }
  }
  function updateSelectedConfig(key: string, value: unknown): void {
    if (selectedNode.value) {
      selectedNode.value.data.config[key] = value;
      scheduleAutosave();
    }
  }
  function addAgentOutputField(): void {
    if (selectedNode.value?.type !== 'agent') return;
    const fields = Array.isArray(selectedNode.value.data.config.outputFields)
      ? selectedNode.value.data.config.outputFields
      : [];
    selectedNode.value.data.config.outputFields = [...fields, { name: '', type: 'string' }];
    scheduleAutosave();
  }
  function removeAgentOutputField(index: number): void {
    if (selectedNode.value?.type !== 'agent') return;
    const fields = Array.isArray(selectedNode.value.data.config.outputFields)
      ? selectedNode.value.data.config.outputFields
      : [];
    selectedNode.value.data.config.outputFields = fields.filter((_, fieldIndex) => fieldIndex !== index);
    scheduleAutosave();
  }
  function updateInputValue(name: string, value: unknown): void {
    inputValues.value = { ...inputValues.value, [name]: value as never };
  }
  function updateToolInput(key: string, value: unknown): void {
    if (selectedNode.value?.type !== 'tool') return;
    const input = (selectedNode.value.data.config.input ?? {}) as Record<string, unknown>;
    selectedNode.value.data.config.input = { ...input, [key]: value };
    scheduleAutosave();
  }
  function startParameters(): StartParameter[] {
    if (selectedNode.value?.type !== 'start') return [];
    const parameters = selectedNode.value.data.config.inputParameters;
    return Array.isArray(parameters) ? parameters as StartParameter[] : [];
  }
  function updateStartParameters(parameters: StartParameter[]): void {
    if (selectedNode.value?.type !== 'start') return;
    selectedNode.value.data.config.inputParameters = parameters;
    scheduleAutosave();
  }
  function addStartParameter(): void {
    const parameters = startParameters();
    let index = 1;
    while (parameters.some((parameter) => parameter.name === `parameter${index}`)) index += 1;
    updateStartParameters([
      ...parameters,
      { name: `parameter${index}`, type: 'string', required: false, description: '自定义输入参数。' },
    ]);
  }
  function updateStartParameter(index: number, key: keyof StartParameter, value: unknown): void {
    const parameters = startParameters();
    if (!parameters[index] || parameters[index].system) return;
    updateStartParameters(parameters.map((parameter, parameterIndex) =>
      parameterIndex === index ? { ...parameter, [key]: value } : parameter,
    ));
  }
  function removeStartParameter(index: number): void {
    const parameters = startParameters();
    if (parameters[index]?.system) return;
    updateStartParameters(parameters.filter((_, parameterIndex) => parameterIndex !== index));
  }

  function connect(connection: {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }): void {
    if (connection.source === connection.target) return;
    if (
      edges.value.some(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target &&
          edge.sourceHandle === connection.sourceHandle,
      )
    )
      return;
    let index = 1;
    while (edges.value.some((edge) => edge.id === 'edge-' + index)) index += 1;
    edges.value = [
      ...edges.value,
      {
        id: 'edge-' + index,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
        label: undefined,
        data: undefined,
        type: 'smoothstep',
        animated: false,
      },
    ];
    scheduleAutosave();
  }
  async function save(silent = false): Promise<void> {
    error.value = '';
    if (!silent && !validation.value.valid) {
      error.value = validation.value.issues.map((issue) => issue.message).join('；');
      return;
    }
    if (typeof window !== 'undefined')
      window.localStorage.setItem(STORAGE_KEY, serializeWorkflowGraph(graph.value));
    autosavePending.value = false;
    savedAt.value = new Date().toLocaleTimeString();
    if (silent) return;
    try {
      await saveWorkflow(uiGraphToWorkflow(graph.value, { id: workflowId.value, name: workflowName.value }));
      message.value = 'Workflow 已保存';
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Workflow 保存失败';
    }
  }
  function loadJson(value: string): void {
    try {
      applyGraph(deserializeWorkflowGraph(value));
      message.value = 'JSON 已加载';
      error.value = '';
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'JSON 加载失败';
    }
  }
  function reset(): void {
    applyGraph(createDefaultWorkflowGraph());
    scheduleAutosave();
    message.value = '已恢复默认 Workflow';
    error.value = '';
    savedAt.value = null;
  }
  function newProject(): void {
    const blank = createDefaultWorkflowGraph();
    blank.id = 'workflow-' + Date.now().toString(36);
    blank.name = 'Untitled workflow';
    applyGraph(blank);
    scheduleAutosave();
    message.value = '已新建项目';
    error.value = '';
    savedAt.value = null;
  }
  function clearSelection(): void {
    selectedNodeId.value = null;
  }
  return {
    workflowId,
    workflowName,
    storeVariables,
    inputValues,
    storeInputs,
    nodes,
    edges,
    selectedNodeId,
    selectedNode,
    graph,
    validation,
    message,
    error,
    savedAt,
    autosavePending,
    initialize,
    replaceNodes,
    replaceEdges,
    addNode,
    selectNode,
    updateSelectedLabel,
    updateSelectedConfig,
    addAgentOutputField,
    removeAgentOutputField,
    updateToolInput,
    startParameters,
    addStartParameter,
    updateStartParameter,
    removeStartParameter,
    updateInputValue,
    connect,
    save,
    loadJson,
    reset,
    newProject,
    clearSelection,
  };
});
