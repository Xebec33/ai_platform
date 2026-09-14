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
  it('reports invalid Loop config instead of throwing when config is null', () => {
    const workflow = loopValidationWorkflow();
    const loop = workflow.nodes.find((node) => node.type === 'loop');
    if (!loop || loop.type !== 'loop') throw new Error('test loop missing');
    (loop as unknown as { config: unknown }).config = null;

    expect(() => validateWorkflow(workflow)).not.toThrow();
    expect(validateWorkflow(workflow).issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['INVALID_NODE_CONFIG', 'INVALID_LOOP_CONFIG']),
    );
  });
  it('rejects bodyNodeId and exitNodeId resolving to the same edge', () => {
    const workflow = loopValidationWorkflow();
    const loop = workflow.nodes.find((node) => node.type === 'loop');
    if (!loop || loop.type !== 'loop') throw new Error('test loop missing');
    loop.config.bodyNodeId = 'end-1';
    loop.config.exitNodeId = 'end-1';

    const result = validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'INVALID_LOOP_CONFIG' })]),
    );
  });
});

function loopValidationWorkflow(): ReturnType<typeof createWorkflowDefinition> {
  const workflow = createWorkflowDefinition('loop-validation', 'Loop Validation');
  workflow.nodes = [
    {
      id: 'start-1',
      type: 'start',
      name: 'Start',
      config: {
        inputParameters: [
          { name: 'inputs', type: 'string', required: true, system: true, description: '' },
        ],
      },
    },
    {
      id: 'loop-1',
      type: 'loop',
      name: 'Loop',
      config: { maxIterations: 1, stopCondition: 'true' },
    },
    { id: 'end-1', type: 'end', name: 'End', config: {} },
  ];
  workflow.edges = [
    { id: 'edge-start-loop', source: 'start-1', target: 'loop-1' },
    { id: 'edge-loop-end', source: 'loop-1', target: 'end-1' },
  ];
  return workflow;
}
