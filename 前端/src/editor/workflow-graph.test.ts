import { describe, expect, it } from 'vitest';
import {
  loopEngineeringDemo,
  uiGraphToWorkflow,
  validateWorkflow,
  workflowToUiGraph,
} from '@ai-workflow/shared-types';
import {
  createDefaultWorkflowGraph,
  deserializeWorkflowGraph,
  graphToVueFlow,
  serializeWorkflowGraph,
  validateWorkflowGraph,
  vueFlowToGraph,
} from './workflow-graph';

describe('workflow graph', () => {
  it('keeps the Loop Engineering demo runnable through a full editor round-trip', () => {
    const uiGraph = workflowToUiGraph(loopEngineeringDemo);
    const flow = graphToVueFlow(uiGraph);
    const back = vueFlowToGraph(flow.nodes, flow.edges, { id: uiGraph.id, name: uiGraph.name });
    expect(validateWorkflowGraph(back).valid).toBe(true);
    const workflow = uiGraphToWorkflow(back, { id: 'wf-loop-trace', name: 'trace' });
    expect(validateWorkflow(workflow).valid).toBe(true);
    const loopNode = workflow.nodes.find((node) => node.type === 'loop');
    expect(loopNode?.config.bodyNodeId).toBe('test-agent');
    expect(loopNode?.config.exitNodeId).toBe('end-1');
  });
  it('drops loop timeout of 0 as unlimited instead of failing backend validation', () => {
    const uiGraph = workflowToUiGraph(loopEngineeringDemo);
    const loopNode = uiGraph.nodes.find((node) => node.type === 'loop');
    if (!loopNode) throw new Error('loop node missing');
    loopNode.data.config = { ...loopNode.data.config, timeout: 0 };
    const workflow = uiGraphToWorkflow(uiGraph, { id: 'wf-zero-timeout', name: 'zero' });
    const converted = workflow.nodes.find((node) => node.type === 'loop');
    expect(converted?.config.timeout).toBeUndefined();
    expect(validateWorkflow(workflow).valid).toBe(true);
  });
  it('converts between graph and Vue Flow without losing config or positions', () => {
    const graph = createDefaultWorkflowGraph();
    const agent = graph.nodes.find((node) => node.type === 'agent');
    if (!agent) throw new Error('agent node missing');
    agent.data.config.model = 'test-model';
    const flow = graphToVueFlow(graph);
    expect(vueFlowToGraph(flow.nodes, flow.edges, { id: graph.id, name: graph.name })).toEqual(
      graph,
    );
  });
  it('serializes and deserializes a valid graph', () => {
    const graph = createDefaultWorkflowGraph();
    expect(deserializeWorkflowGraph(serializeWorkflowGraph(graph))).toEqual(graph);
  });
  it('checks required nodes and edge endpoints', () => {
    const graph = createDefaultWorkflowGraph();
    graph.nodes = graph.nodes.filter((node) => node.type !== 'start');
    graph.edges.push({ id: 'broken', source: 'missing', target: 'end-1' });
    const result = validateWorkflowGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['MISSING_START', 'UNKNOWN_EDGE_SOURCE']),
    );
  });
  it('rejects malformed JSON', () => {
    expect(() => deserializeWorkflowGraph('{')).toThrow('Workflow JSON 格式无效');
  });
  it('fills default node config when loading a graph with missing config', () => {
    const broken = {
      id: 'workflow-1',
      name: 'Untitled workflow',
      version: 1,
      variables: {},
      inputs: [],
      nodes: [
        {
          id: 'start-1',
          type: 'start',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: {} },
        },
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 100, y: 0 },
          data: { label: 'Agent', config: {} },
        },
        {
          id: 'end-1',
          type: 'end',
          position: { x: 200, y: 0 },
          data: { label: 'End', config: {} },
        },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'agent-1' },
        { id: 'e2', source: 'agent-1', target: 'end-1' },
      ],
    };
    const graph = deserializeWorkflowGraph(JSON.stringify(broken));
    const flow = graphToVueFlow(graph);
    const agent = flow.nodes.find((node) => node.id === 'agent-1');
    expect(agent?.data.config).toMatchObject({
      model: 'deepseek-chat',
      systemPrompt: expect.any(String),
      outputFormat: 'text',
      temperature: 0.7,
      maxTokens: 8192,
    });
    const start = flow.nodes.find((node) => node.id === 'start-1');
    expect(start?.data.config.inputParameters).toEqual([
      { name: 'inputs', type: 'string', required: true, system: true, description: expect.any(String) },
    ]);
  });
  it('generates unique edge ids when loading a graph with id-less edges', () => {
    const broken = {
      id: 'workflow-1',
      name: 'Untitled workflow',
      version: 1,
      variables: {},
      inputs: [],
      nodes: [
        { id: 'start-1', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start', config: {} } },
        { id: 'agent-1', type: 'agent', position: { x: 100, y: 0 }, data: { label: 'Agent', config: {} } },
        { id: 'tool-1', type: 'tool', position: { x: 200, y: 0 }, data: { label: 'Tool', config: {} } },
        { id: 'end-1', type: 'end', position: { x: 300, y: 0 }, data: { label: 'End', config: {} } },
      ],
      edges: [
        { source: 'start-1', target: 'agent-1' },
        { source: 'agent-1', target: 'tool-1' },
        { source: 'tool-1', target: 'end-1' },
        { id: 'edge-1', source: 'agent-1', target: 'end-1' },
      ],
    };
    const graph = deserializeWorkflowGraph(JSON.stringify(broken));
    const ids = graph.edges.map((edge) => edge.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('edge-1');
  });
});
