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
});
