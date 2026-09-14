import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/agents/agent-registry.js';
import { CodingAgentExecutor, OpenCodeAdapter } from '../../src/coding-agent/index.js';
import { createWorkflowDefinition } from '@ai-workflow/shared-types';
import { createWorkflowRuntime } from '../../src/workflow/runtime/index.js';

async function fakeAgentExecutable(output: string, exitCode = 0): Promise<{
  root: string;
  executable: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-coding-agent-'));
  const executable = path.join(root, 'fake-opencode.sh');
  await writeFile(
    executable,
    `#!/bin/sh\nprintf '%s\\n' '${output.replaceAll("'", "'\\''")}'\nexit ${exitCode}\n`,
    'utf8',
  );
  await chmod(executable, 0o755);
  return { root, executable };
}

describe('OpenCodeAdapter', () => {
  it('executes a coding-agent command and parses JSON events', async () => {
    const fixture = await fakeAgentExecutable(
      JSON.stringify({ type: 'text', part: { text: 'implemented and tested' } }),
    );
    try {
      const result = await new OpenCodeAdapter({ executable: fixture.executable }).execute({
        prompt: 'add a feature',
        workspaceRoot: fixture.root,
      });
      expect(result.summary).toBe('implemented and tested');
      expect(result.events).toHaveLength(1);
      expect(result.capabilities).toContain('file-write');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('classifies a non-zero agent process as retryable failure', async () => {
    const fixture = await fakeAgentExecutable('failure', 2);
    try {
      await expect(
        new OpenCodeAdapter({ executable: fixture.executable }).execute({
          prompt: 'fail',
          workspaceRoot: fixture.root,
        }),
      ).rejects.toMatchObject({ code: 'AGENT_FAILED', retryable: true });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('cancels a running process and classifies cancellation', async () => {
    const fixture = await fakeAgentExecutable('sleep 2');
    await writeFile(
      fixture.executable,
      '#!/bin/sh\nsleep 2\nprintf \'%s\\n\' \'done\'\n',
      'utf8',
    );
    await chmod(fixture.executable, 0o755);
    const controller = new AbortController();
    const running = new OpenCodeAdapter({ executable: fixture.executable }).execute({
      prompt: 'cancel',
      workspaceRoot: fixture.root,
      signal: controller.signal,
      timeoutMs: 5_000,
    });
    setTimeout(() => controller.abort(), 20);
    try {
      await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

describe('CodingAgentExecutor and Workflow Runtime', () => {
  it('resolves a registered coding agent executor from an Agent node', async () => {
    const fixture = await fakeAgentExecutable(
      JSON.stringify({ type: 'text', part: { text: 'code changed' } }),
    );
    try {
      const workflow = createWorkflowDefinition('coding-agent-workflow', 'Coding Agent Workflow');
      const agent = workflow.nodes.find((node) => node.type === 'agent');
      if (!agent || agent.type !== 'agent') throw new Error('agent node missing');
      agent.config.executorId = 'coding-agent';
      agent.config.outputSchema = { type: 'object' };
      const registry = new AgentRegistry([
        [
          'coding-agent',
          new CodingAgentExecutor({
            adapter: new OpenCodeAdapter({ executable: fixture.executable }),
          }),
        ],
      ]);
      const result = await createWorkflowRuntime(workflow, {
        agentRegistry: registry,
        workspaceRoot: fixture.root,
      }).execute();
      expect(result.status).toBe('SUCCESS');
      expect(result.output).toMatchObject({ summary: 'code changed' });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('fails clearly when a workflow references an unregistered executor', async () => {
    const workflow = createWorkflowDefinition('missing-coding-agent', 'Missing Coding Agent');
    const agent = workflow.nodes.find((node) => node.type === 'agent');
    if (!agent || agent.type !== 'agent') throw new Error('agent node missing');
    agent.config.executorId = 'missing-agent';
    const result = await createWorkflowRuntime(workflow, {
      agentRegistry: new AgentRegistry(),
    }).execute();
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('AGENT_NOT_FOUND');
  });
});
