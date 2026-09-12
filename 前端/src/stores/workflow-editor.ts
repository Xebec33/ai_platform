import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
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
type Flow = ReturnType<typeof graphToVueFlow>;

export const useWorkflowEditorStore = defineStore('workflow-editor', () => {
  const initial = graphToVueFlow(createDefaultWorkflowGraph());
  const workflowId = ref('workflow-1');
  const workflowName = ref('Untitled workflow');
  const nodes = ref<Flow['nodes']>(initial.nodes);
  const edges = ref<Flow['edges']>(initial.edges);
  const selectedNodeId = ref<string | null>(null);
  const message = ref('');
  const error = ref('');
  const savedAt = ref<string | null>(null);
  const selectedNode = computed(
    () => nodes.value.find((node) => node.id === selectedNodeId.value) ?? null,
  );
  const graph = computed<WorkflowGraph>(() =>
    vueFlowToGraph(nodes.value, edges.value, { id: workflowId.value, name: workflowName.value }),
  );
  const validation = computed(() => validateWorkflowGraph(graph.value));

  function applyGraph(next: WorkflowGraph): void {
    const flow = graphToVueFlow(next);
    workflowId.value = next.id;
    workflowName.value = next.name;
    nodes.value = flow.nodes;
    edges.value = flow.edges;
    selectedNodeId.value = null;
  }
  function initialize(): void {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      applyGraph(deserializeWorkflowGraph(stored));
      message.value = '已从本地存储恢复 Workflow';
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '本地 Workflow 无法加载';
    }
  }
  function replaceNodes(next: Flow['nodes']): void {
    const ids = new Set(next.map((node) => node.id));
    nodes.value = next;
    edges.value = edges.value.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    if (selectedNodeId.value && !ids.has(selectedNodeId.value)) selectedNodeId.value = null;
  }
  function replaceEdges(next: Flow['edges']): void {
    edges.value = next;
  }
  function nextId(type: WorkflowNodeType): string {
    let index = 1;
    while (nodes.value.some((node) => node.id === type + '-' + index)) index += 1;
    return type + '-' + index;
  }
  function addNode(type: WorkflowNodeType): void {
    const node = createWorkflowGraphNode(type, nextId(type), {
      x: 160 + (nodes.value.length % 3) * 240,
      y: 100 + Math.floor(nodes.value.length / 3) * 150,
    });
    const flow = graphToVueFlow({
      id: workflowId.value,
      name: workflowName.value,
      version: 1,
      nodes: [node],
      edges: [],
    });
    const created = flow.nodes[0];
    if (!created) return;
    nodes.value = [...nodes.value, created];
    selectedNodeId.value = node.id;
  }
  function selectNode(id: string | null): void {
    selectedNodeId.value = id;
  }
  function updateSelectedLabel(label: string): void {
    if (selectedNode.value) selectedNode.value.data.label = label;
  }
  function updateSelectedConfig(key: string, value: unknown): void {
    if (selectedNode.value) selectedNode.value.data.config[key] = value;
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
  }
  function save(): void {
    error.value = '';
    if (!validation.value.valid) {
      error.value = validation.value.issues.map((issue) => issue.message).join('；');
      return;
    }
    if (typeof window !== 'undefined')
      window.localStorage.setItem(STORAGE_KEY, serializeWorkflowGraph(graph.value));
    savedAt.value = new Date().toLocaleTimeString();
    message.value = 'Workflow 已保存';
  }
  function load(): void {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      error.value = '本地没有已保存的 Workflow';
      return;
    }
    try {
      applyGraph(deserializeWorkflowGraph(stored));
      message.value = 'Workflow 已加载';
      error.value = '';
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Workflow 加载失败';
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
    message.value = '已恢复默认 Workflow';
    error.value = '';
    savedAt.value = null;
  }
  function clearSelection(): void {
    selectedNodeId.value = null;
  }
  return {
    workflowId,
    workflowName,
    nodes,
    edges,
    selectedNodeId,
    selectedNode,
    graph,
    validation,
    message,
    error,
    savedAt,
    initialize,
    replaceNodes,
    replaceEdges,
    addNode,
    selectNode,
    updateSelectedLabel,
    updateSelectedConfig,
    connect,
    save,
    load,
    loadJson,
    reset,
    clearSelection,
  };
});
