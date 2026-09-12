import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHealth } from './health';

describe('getHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests and returns the backend health response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'ok',
            service: 'backend',
            timestamp: '2026-01-01T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(getHealth('http://backend.test')).resolves.toEqual({
      status: 'ok',
      service: 'backend',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  });

  it('throws when the backend returns an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(getHealth('http://backend.test')).rejects.toThrow('Health check failed: 503');
  });
});
