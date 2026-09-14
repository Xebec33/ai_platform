import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';

describe('Self-development routes', () => {
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('exposes the normal self-development workflow definition', async () => {
    app = await createApp({ logger: false });
    const response = await app.inject({ method: 'GET', url: '/self-development/workflow?taskId=http-node' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'self-development-v1',
      variables: { taskId: 'http-node' },
    });
  });

  it('requires explicit self-development configuration before execution', async () => {
    app = await createApp({ logger: false });
    const response = await app.inject({ method: 'POST', url: '/self-development/run', payload: { taskId: 'http-node' } });
    expect(response.statusCode).toBe(503);
  });
});
