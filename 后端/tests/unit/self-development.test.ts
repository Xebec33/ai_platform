import { describe, expect, it } from 'vitest';
import { validateWorkflow } from '@ai-workflow/shared-types';
import { createWorkflowRuntime } from '../../src/workflow/runtime/index.js';
import { createMockSelfDevelopmentWorkflow } from '../../src/self-development/index.js';

describe('mock self-development workflow', () => {
  it('contains the complete requirement-to-fix graph', () => {
    const workflow = createMockSelfDevelopmentWorkflow('增加一个节点');
    expect(validateWorkflow(workflow)).toMatchObject({ valid: true });
    expect(workflow.nodes.map((node) => node.name)).toEqual([
      'Start',
      'Requirement Analyzer',
      'Task Decomposer',
      'Frontend Agent',
      'Backend Agent',
      'Test and Review Loop',
      'Test Agent',
      'Reviewer',
      'Passed?',
      'Fix Agent',
      'End',
    ]);
  });

  it('fails the first test, enters Fix, then succeeds on the second iteration', async () => {
    const workflow = createMockSelfDevelopmentWorkflow();
    const result = await createWorkflowRuntime(workflow, {
      maxAgentRetries: 0,
      agentExecutor: async ({ node, input, variables }) => {
        const role = node.config.mockRole;
        if (role === 'test') return { output: { passed: variables.fixed === true } };
        if (role === 'review') return { output: { passed: variables.test?.passed === true } };
        if (role === 'fix') {
          variables.fixed = true;
          return { output: { fixed: true } };
        }
        if (role === 'requirement') return { output: { requirement: input } };
        if (role === 'plan') return { output: { tasks: ['frontend', 'backend', 'test', 'review'] } };
        return { output: { completed: true } };
      },
    }).execute();

    expect(result.status).toBe('SUCCESS');
    expect(result.iterations['loop-1']).toBe(2);
    expect(result.nodeRuns.filter((run) => run.nodeId === 'test-agent')).toHaveLength(2);
    expect(result.nodeRuns.some((run) => run.nodeId === 'fix-agent')).toBe(true);
    expect(result.output).toMatchObject({ passed: true });
  });
});
