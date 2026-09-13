import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { createWorkflowDefinition } from '@ai-workflow/shared-types';

function persistenceStub() {
  const workflows = new Map<string, ReturnType<typeof createWorkflowDefinition>>();
  const runs = new Map<string, unknown>();
  return {
    workflows,
    runs,
    async saveWorkflow(workflow: ReturnType<typeof createWorkflowDefinition>) {
      workflows.set(workflow.id, workflow);
    },
    async saveRun(run: unknown) {
      runs.set((run as { id: string }).id, run);
    },
    async saveNodeRun() {},
    async saveState() {},
    async saveCheckpoint() {},
    async getWorkflow(id: string) {
      return workflows.get(id);
    },
    async getRun(id: string) {
      return runs.get(id) as never;
    },
  };
}

describe('Persistence-backed workflow routes', () => {
  it('stores a workflow and serves it after the app is recreated', async () => {
    const persistence = persistenceStub();
    const workflow = createWorkflowDefinition('persisted-workflow', 'Persisted');
    const firstApp = await createApp({ persistence });
    const createResponse = await firstApp.inject({
      method: 'POST',
      url: '/workflows',
      payload: { workflow },
    });
    await firstApp.close();

    const secondApp = await createApp({ persistence });
    const getResponse = await secondApp.inject({
      method: 'GET',
      url: '/workflows/persisted-workflow',
    });
    await secondApp.close();

    expect(createResponse.statusCode).toBe(201);
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({ id: 'persisted-workflow', name: 'Persisted' });
  });
});
