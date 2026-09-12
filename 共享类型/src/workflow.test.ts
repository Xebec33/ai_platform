import { describe, expect, it } from 'vitest';
import {
  createWorkflowDefinition,
  serializeWorkflow,
  uiGraphToWorkflow,
  workflowToUiGraph,
} from './workflow.js';
import { validateWorkflow } from './workflow-validator.js';

describe('workflow DSL', () => {
  it('validates Start -> Agent -> End', () => {
    expect(validateWorkflow(createWorkflowDefinition()).valid).toBe(true);
  });
  it('round trips UI graph without leaking positions into DSL', () => {
    const source = workflowToUiGraph(createWorkflowDefinition());
    const workflow = uiGraphToWorkflow(source);
    expect(workflow.nodes[1]?.type).toBe('agent');
    expect(workflow.nodes[1]).not.toHaveProperty('position');
    expect(validateWorkflow(workflow).valid).toBe(true);
  });
  it('reports missing endpoints, duplicate IDs and dangling edges', () => {
    const workflow = createWorkflowDefinition();
    workflow.nodes = workflow.nodes.filter((node) => node.type !== 'start');
    workflow.nodes.push({ ...workflow.nodes[0]!, id: 'end-1' });
    workflow.edges.push({ id: 'edge-broken', source: 'missing', target: 'end-1' });
    const result = validateWorkflow(workflow);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['MISSING_START', 'DUPLICATE_NODE_ID', 'UNKNOWN_EDGE_SOURCE']),
    );
  });
  it('checks Agent, Condition and Loop configurations', () => {
    const workflow = createWorkflowDefinition();
    workflow.nodes[1] = {
      id: 'agent-1',
      type: 'agent',
      name: 'Agent',
      config: { model: '', systemPrompt: '', temperature: 3, maxTokens: 0 },
    };
    workflow.nodes.push({
      id: 'condition-1',
      type: 'condition',
      name: 'Condition',
      config: { expression: '' },
    });
    workflow.nodes.push({
      id: 'loop-1',
      type: 'loop',
      name: 'Loop',
      config: { maxIterations: 0, stopCondition: '' },
    });
    const codes = validateWorkflow(workflow).issues.map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'INVALID_AGENT_CONFIG',
        'INVALID_CONDITION_CONFIG',
        'INVALID_LOOP_CONFIG',
      ]),
    );
  });
  it('rejects unreachable and unterminated nodes', () => {
    const workflow = createWorkflowDefinition();
    workflow.nodes.push({
      id: 'orphan',
      type: 'agent',
      name: 'Orphan',
      config: { model: 'm', systemPrompt: 's' },
    });
    const codes = validateWorkflow(workflow).issues.map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['UNREACHABLE_NODE', 'UNTERMINATED_NODE']));
  });
  it('serializes a versioned JSON document', () => {
    expect(JSON.parse(serializeWorkflow(createWorkflowDefinition())).version).toBe(1);
  });
});
