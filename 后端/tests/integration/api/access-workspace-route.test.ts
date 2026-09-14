import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';

describe('invite code guard', () => {
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('rejects requests without a valid invite code and accepts valid ones', async () => {
    app = await createApp({ inviteCode: 'secret-code' });
    const rejected = await app.inject({ method: 'GET', url: '/workflows/demos' });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toMatchObject({ code: 'INVITE_CODE_REQUIRED' });

    const viaHeader = await app.inject({
      method: 'GET',
      url: '/workflows/demos',
      headers: { 'x-invite-code': 'secret-code' },
    });
    expect(viaHeader.statusCode).toBe(200);

    const viaQuery = await app.inject({
      method: 'GET',
      url: '/workflows/demos?invite_code=secret-code',
    });
    expect(viaQuery.statusCode).toBe(200);
  });

  it('keeps health and invite verification public', async () => {
    app = await createApp({ inviteCode: 'secret-code' });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const wrong = await app.inject({ method: 'POST', url: '/auth/invite', payload: { code: 'nope' } });
    expect(wrong.statusCode).toBe(401);
    const right = await app.inject({
      method: 'POST',
      url: '/auth/invite',
      payload: { code: 'secret-code' },
    });
    expect(right.statusCode).toBe(200);
  });

  it('does not enforce anything when no invite code is configured', async () => {
    app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/workflows/demos' });
    expect(response.statusCode).toBe(200);
  });
});

describe('workspace file routes', () => {
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let workspace: string | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (workspace) await rm(workspace, { recursive: true, force: true });
    workspace = undefined;
  });

  it('lists workspace files and serves file content', async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-ws-'));
    await writeFile(path.join(workspace, 'requirement.txt'), '会员积分系统需求');
    await mkdir(path.join(workspace, 'output'));
    await writeFile(path.join(workspace, 'output', 'result.txt'), '结果内容');

    app = await createApp({ workspaceRoot: workspace, monitor: null });
    const list = await app.inject({ method: 'GET', url: '/workspace/files' });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'requirement.txt', type: 'file' }),
        expect.objectContaining({ path: 'output', type: 'directory' }),
        expect.objectContaining({ path: 'output/result.txt', type: 'file' }),
      ]),
    );

    const file = await app.inject({ method: 'GET', url: '/workspace/file?path=requirement.txt' });
    expect(file.statusCode).toBe(200);
    expect(file.json()).toMatchObject({ path: 'requirement.txt', content: '会员积分系统需求' });
  });

  it('rejects paths outside the workspace', async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-ws-'));
    app = await createApp({ workspaceRoot: workspace, monitor: null });
    const response = await app.inject({ method: 'GET', url: '/workspace/file?path=../outside.txt' });
    expect(response.statusCode).toBe(403);
  });
});
