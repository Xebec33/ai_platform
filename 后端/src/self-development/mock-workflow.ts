import type { StartConfig, WorkflowDefinition, WorkflowNode } from '@ai-workflow/shared-types';

export const MOCK_SELF_DEVELOPMENT_WORKFLOW_ID = 'self-development-mock-v1';

export function createMockSelfDevelopmentWorkflow(
  requirement = '完善 AI Workflow Platform 的一个功能',
): WorkflowDefinition {
  return {
    id: MOCK_SELF_DEVELOPMENT_WORKFLOW_ID,
    name: 'Mock 自举 Workflow',
    version: 1,
    variables: { requirement },
    nodes: [
      { id: 'start-1', type: 'start', name: 'Start', config: startConfig() },
      agent('requirement-analyzer', 'Requirement Analyzer', 'requirement', 'requirement'),
      agent('task-decomposer', 'Task Decomposer', 'plan', 'plan'),
      agent('frontend-agent', 'Frontend Agent', 'frontend', 'frontend'),
      agent('backend-agent', 'Backend Agent', 'backend', 'backend'),
      {
        id: 'loop-1',
        type: 'loop',
        name: 'Test and Review Loop',
        config: {
          maxIterations: 3,
          stopCondition: 'variables.review.passed == true',
          bodyNodeId: 'test-agent',
          exitNodeId: 'end-1',
        },
      },
      agent('test-agent', 'Test Agent', 'test', 'test', '{{nodes.fix-agent}}'),
      agent('reviewer', 'Reviewer', 'review', 'review', '{{nodes.test-agent}}'),
      {
        id: 'condition-1',
        type: 'condition',
        name: 'Passed?',
        config: {
          expression: 'variables.review.passed == true',
          trueLabel: 'true',
          falseLabel: 'false',
        },
      },
      agent('fix-agent', 'Fix Agent', 'fix', 'fix', '{{nodes.test-agent}}'),
      { id: 'end-1', type: 'end', name: 'End', config: {} },
    ],
    edges: [
      edge('edge-start', 'start-1', 'requirement-analyzer'),
      edge('edge-requirement', 'requirement-analyzer', 'task-decomposer'),
      edge('edge-tasks', 'task-decomposer', 'frontend-agent'),
      edge('edge-frontend', 'frontend-agent', 'backend-agent'),
      edge('edge-backend', 'backend-agent', 'loop-1'),
      edge('edge-loop-body', 'loop-1', 'test-agent', 'body'),
      edge('edge-loop-exit', 'loop-1', 'end-1', 'exit'),
      edge('edge-test-review', 'test-agent', 'reviewer'),
      edge('edge-review-condition', 'reviewer', 'condition-1'),
      edge('edge-condition-loop', 'condition-1', 'loop-1', 'true'),
      edge('edge-condition-fix', 'condition-1', 'fix-agent', 'false'),
      edge('edge-fix-loop', 'fix-agent', 'loop-1'),
    ],
  };
}

function startConfig(): StartConfig {
  return {
    inputParameters: [
      { name: 'inputs', type: 'string', required: true, system: true, description: '工作流总输入。' },
      { name: 'requirement', type: 'string', required: true, description: '本次开发需求描述。' },
    ],
  };
}

function agent(
  id: string,
  name: string,
  mockRole: string,
  outputKey: string,
  input?: string,
): WorkflowNode {
  return {
    id,
    type: 'agent',
    name,
    config: {
      model: 'mock',
      systemPrompt: 'Mock 自举 Agent: ' + name,
      mockRole,
      outputKey,
      outputSchema: { type: 'object' },
      ...(input ? { input: input as never } : {}),
    },
  } as WorkflowNode;
}

function edge(id: string, source: string, target: string, condition?: string) {
  return { id, source, target, ...(condition ? { condition } : {}) };
}
