import { hostname } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { computeUptimeSeconds } from '../src/api/routes/health.js';

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

  it('includes uptime as a non-negative finite number of seconds', async () => {
    app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(body, 'uptime')).toBe(true);
    expect(typeof body.uptime).toBe('number');
    expect(Number.isFinite(body.uptime)).toBe(true);
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('includes host as the current machine hostname', async () => {
    app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(body, 'host')).toBe(true);
    expect(typeof body.host).toBe('string');
    expect(body.host.length).toBeGreaterThan(0);
    expect(body.host).toBe(hostname());
  });

  it('keeps existing fields unchanged while adding uptime and host', async () => {
    app = await createApp();
    const body = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(Object.keys(body).sort()).toEqual(
      ['host', 'service', 'status', 'timestamp', 'uptime', 'version'].sort(),
    );
    expect(body.status).toBe('ok');
    expect(body.service).toBe('backend');
    expect(body.version).toBe('1.0.0');
    expect(body.host).toBe(hostname());
  });

  it('keeps uptime monotonically non-decreasing while the process runs', async () => {
    app = await createApp();
    const first = (await app.inject({ method: 'GET', url: '/health' })).json().uptime;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = (await app.inject({ method: 'GET', url: '/health' })).json().uptime;
    expect(second).toBeGreaterThanOrEqual(first);
  });
});

describe('computeUptimeSeconds', () => {
  it('returns 0 at the start instant, so a restart resets to the initial value', () => {
    expect(computeUptimeSeconds(1_000, 1_000)).toBe(0);
  });

  it('returns elapsed time in seconds since the start instant', () => {
    expect(computeUptimeSeconds(1_000, 6_500)).toBe(5.5);
  });

  it('never returns a negative value under clock skew', () => {
    expect(computeUptimeSeconds(2_000, 1_000)).toBe(0);
  });
});
