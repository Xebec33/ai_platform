import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/app.js';
import { createWorkflowDefinition, documentQualityDemo, loopEngineeringDemo, orderDiagnosisDemo, ticketRoutingDemo } from '@ai-workflow/shared-types';

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

  it('validates required input variables before running a workflow', async () => {
    app = await createApp();
    const response = await app.inject({ method: 'POST', url: '/workflows/run', payload: { workflow: ticketRoutingDemo, variables: { userId: 'u-1' } } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ status: 'FAILED', errorCode: 'MISSING_INPUT_VARIABLE' });
  });

  it('lists and serves the four runnable business demos', async () => {
    app = await createApp();
    const list = await app.inject({ method: 'GET', url: '/workflows/demos' });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((item: { id: string }) => item.id)).toEqual([
      ticketRoutingDemo.id,
      orderDiagnosisDemo.id,
      documentQualityDemo.id,
      loopEngineeringDemo.id,
    ]);
    const detail = await app.inject({ method: 'GET', url: '/workflows/demos/' + ticketRoutingDemo.id });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: ticketRoutingDemo.id, inputs: expect.any(Array) });
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

  it.each([
    [ticketRoutingDemo, { userId: 'u-1001', message: '支付后两个小时没有发货', orderId: 'order-1' }, ['classify-ticket', 'ticket-urgent', 'send-alert', 'create-human-ticket']],
    [orderDiagnosisDemo, { orderId: 'order-1' }, ['lookup-order', 'order-abnormal', 'analyze-order', 'can-auto-fix', 'retry-fulfillment', 'order-success-result']],
  ])('runs %s through its expected business branch', async (workflow, variables, expectedNodes) => {
    const agentExecutor = vi.fn(async ({ node }: { node: { id: string } }) => ({
      output: node.id === 'classify-ticket'
        ? { category: '订单履约', subCategory: '支付后未发货', priority: 'high', assignedTeam: '订单履约团队', needsHuman: true, reason: '测试' }
        : node.id === 'analyze-order'
          ? { reason: '履约未推进', severity: 'medium', canAutoFix: true, suggestedAction: '重试履约' }
          : { message: '测试完成', action: 'DONE' },
    }));
    app = await createApp({ agentExecutor });
    const response = await app.inject({ method: 'POST', url: '/workflows/run', payload: { workflow, variables } });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('SUCCESS');
    expect(response.json().nodeRuns.map((run: { nodeId: string }) => run.nodeId)).toEqual(expect.arrayContaining(expectedNodes));
  });

  it('runs the loop engineering demo and recovers from the first failed iteration', async () => {
    let fixed = false;
    const agentExecutor = async ({ node }: { node: { id: string } }) => {
      if (node.id === 'test-agent')
        return { output: { passed: fixed, attempt: fixed ? 2 : 1, failures: fixed ? [] : ['首次测试失败'] } };
      if (node.id === 'reviewer')
        return { output: { passed: fixed, issues: fixed ? [] : ['存在未修复问题'] } };
      if (node.id === 'fix-agent') {
        fixed = true;
        return { output: { fixed: true, summary: '已修复' } };
      }
      return { output: { summary: '实现完成' } };
    };
    app = await createApp({ agentExecutor });
    const response = await app.inject({
      method: 'POST',
      url: '/workflows/run',
      payload: { workflow: loopEngineeringDemo, variables: { task: '实现积分过期规则' } },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('SUCCESS');
    const executed = body.nodeRuns.map((run: { nodeId: string }) => run.nodeId);
    expect(executed.filter((nodeId: string) => nodeId === 'fix-agent')).toHaveLength(1);
    expect(executed.filter((nodeId: string) => nodeId === 'test-agent')).toHaveLength(2);
    expect(body.variables.review).toMatchObject({ passed: true });
  });

  it('uses the injected real Agent Executor for an Agent node', async () => {
    const agentExecutor = vi.fn(async () => ({ output: { passed: true, source: 'injected-agent' } }));
    app = await createApp({ agentExecutor });
    const workflow = createWorkflowDefinition('injected-agent', 'Injected Agent');
    const response = await app.inject({ method: 'POST', url: '/workflows/run', payload: { workflow } });
    expect(response.statusCode).toBe(200);
    expect(agentExecutor).toHaveBeenCalled();
    expect(response.json().output).toMatchObject({ passed: true, source: 'injected-agent' });
  });

  it('runs the document quality demo and writes the revised document', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'ai-workflow-demo-'));
    await writeFile(path.join(workspace, 'input.txt'), '会员积分系统需求');
    const agentExecutor = vi.fn(async ({ node }: { node: { id: string } }) => ({
      output: node.id === 'check-quality'
        ? { passed: false, severity: 'high', issues: [{ section: '功能需求', problem: '缺少规则' }] }
        : node.id === 'extract-document'
          ? { title: '会员积分系统', sections: ['功能需求'], keyEntities: ['积分'] }
          : node.id === 'recommend-document-fix'
            ? { changes: ['补充积分过期规则'] }
            : node.id === 'revise-document'
              ? { revisedDocument: '会员积分系统\n\n已补充积分过期规则。', changes: ['补充积分过期规则'] }
              : { summary: '摘要', tags: ['积分'] },
    }));
    app = await createApp({ workspaceRoot: workspace, agentExecutor });
    const response = await app.inject({ method: 'POST', url: '/workflows/run', payload: { workflow: documentQualityDemo, variables: { filePath: 'input.txt' } } });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('SUCCESS');
    await expect(readFile(path.join(workspace, 'output/revised-requirement.txt'), 'utf8')).resolves.toContain('积分过期规则');
    await rm(workspace, { recursive: true, force: true });
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
