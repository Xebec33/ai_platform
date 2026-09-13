import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/app.js';
import { createWorkflowDefinition } from '@ai-workflow/shared-types';

describe('POST /workflows/run', () => {
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('executes a valid workflow through the HTTP API', async () => {
    app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/workflows/run',
      payload: {
        workflow: createWorkflowDefinition('api-demo', 'API Demo'),
        variables: { query: 'hello' },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ workflowId: 'api-demo', status: 'SUCCESS' });
  });

  it('returns the mock self-development workflow definition', async () => {
    app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/workflows/mock-self-development' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'self-development-mock-v1',
      name: 'Mock 自举 Workflow',
    });
  });

  it('rejects an invalid workflow before persistence', async () => {
    const saveWorkflow = vi.fn();
    app = await createApp({
      persistence: {
        saveWorkflow,
        saveRun: async () => {},
        saveNodeRun: async () => {},
        saveState: async () => {},
        saveCheckpoint: async () => {},
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/workflows',
      payload: { workflow: { foo: 'bar' } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'Workflow 校验失败' });
    expect(saveWorkflow).not.toHaveBeenCalled();
  });

  it('returns validation issues for an invalid workflow', async () => {
    app = await createApp();
    const workflow = createWorkflowDefinition();
    workflow.nodes = workflow.nodes.filter((node) => node.type !== 'start');
    const response = await app.inject({
      method: 'POST',
      url: '/workflows/run',
      payload: { workflow },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'Workflow 校验失败' });
    expect(response.json().issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MISSING_START' })]),
    );
  });
});
