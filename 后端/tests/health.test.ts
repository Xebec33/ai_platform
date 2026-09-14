import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  it('returns the backend health status', async () => {
    app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ status: 'ok', service: 'backend' });
    expect(body.version).toBe('1.0.0');
    expect(typeof body.version).toBe('string');
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
  });
});
