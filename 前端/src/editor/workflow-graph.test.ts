import { describe, expect, it } from 'vitest';
import {
  createDefaultWorkflowGraph,
  deserializeWorkflowGraph,
  graphToVueFlow,
  serializeWorkflowGraph,
  validateWorkflowGraph,
  vueFlowToGraph,
} from './workflow-graph';

describe('workflow graph', () => {
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
      model: 'gpt-4o-mini',
      systemPrompt: expect.any(String),
      outputFormat: 'text',
      temperature: 0.7,
      maxTokens: 2048,
    });
    const start = flow.nodes.find((node) => node.id === 'start-1');
    expect(start?.data.config.inputParameters).toEqual([
      { name: 'inputs', type: 'string', required: true, system: true, description: expect.any(String) },
    ]);
  });
});
