import { describe, expect, it } from 'vitest';
import { validateWorkflow } from '@ai-workflow/shared-types';
import { createSelfDevelopmentWorkflow } from '../../src/self-development/index.js';

 describe('Phase 13 self-development workflow', () => {
  it('is a normal workflow with coding, test, review, fix, loop and commit stages', () => {
    const workflow = createSelfDevelopmentWorkflow({ taskId: 'http-node' });
    expect(validateWorkflow(workflow)).toMatchObject({ valid: true });
    expect(workflow.nodes.map((node) => node.id)).toEqual([
      'start-1',
      'requirement-analyzer',
      'task-decomposer',
      'coding-agent',
      'loop-1',
      'test-agent',
      'reviewer',
      'condition-1',
      'fix-agent',
      'commit-1',
      'end-1',
    ]);
    expect(workflow.edges.find((edge) => edge.source === 'condition-1' && edge.condition === 'true')?.target).toBe('loop-1');
    expect(workflow.edges.find((edge) => edge.source === 'condition-1' && edge.condition === 'false')?.target).toBe('fix-agent');
    expect(workflow.nodes.find((node) => node.id === 'coding-agent')?.config.executorId).toBe('coding-agent');
  });
});
