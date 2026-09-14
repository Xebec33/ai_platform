import type { StartConfig, WorkflowDefinition, WorkflowNode } from '@ai-workflow/shared-types';

export const SELF_DEVELOPMENT_WORKFLOW_ID = 'self-development-v1';

export interface SelfDevelopmentWorkflowOptions {
  taskId?: string;
  requirement?: string;
  model?: string;
  codingModel?: string;
  codingExecutorId?: string;
  codingTimeoutMs?: number;
  maxIterations?: number;
}

export function createSelfDevelopmentWorkflow(
  options: SelfDevelopmentWorkflowOptions = {},
): WorkflowDefinition {
  const taskId = options.taskId ?? 'platform-task';
  const requirement = options.requirement ?? '给 AI Workflow Platform 增加一个功能';
  const model = options.model ?? 'gpt-4o-mini';
  const codingModel = options.codingModel ?? model;
  const codingExecutorId = options.codingExecutorId ?? 'coding-agent';
  const codingTimeoutMs = options.codingTimeoutMs ?? 900_000;
  const maxIterations = options.maxIterations ?? 3;
  return {
    id: SELF_DEVELOPMENT_WORKFLOW_ID,
    name: '平台自举开发 Workflow',
    version: 1,
    variables: { requirement, taskId, fixed: false },
    nodes: [
      { id: 'start-1', type: 'start', name: 'Start', config: startConfig() },
      agent('requirement-analyzer', 'Requirement Analyzer', model, 'requirement', '仅根据任务输入文本分析需求，不需要读取代码或执行命令。输出 { goals, acceptanceCriteria, constraints, impactScope }。', undefined, 'requirement'),
      agent('task-decomposer', 'Task Decomposer', model, 'plan', '仅根据已分析的需求拆分任务，不需要读取代码或执行命令。输出 { tasks: [{ name, type, description }] }，type 取 frontend、backend、test 或 review。', undefined, 'plan'),
      agent('coding-agent', 'Coding Agent', codingModel, 'coding', '在当前 workspace 中实现需求，读取项目上下文，修改代码并返回摘要。', codingExecutorId, undefined, codingTimeoutMs),
      {
        id: 'loop-1',
        type: 'loop',
        name: 'Test and Review Loop',
        config: {
          maxIterations,
          stopCondition: 'variables.review.passed == true',
          bodyNodeId: 'test-agent',
          exitNodeId: 'commit-1',
        },
      },
      agent('test-agent', 'Test Agent', model, 'test', '在 workspace 中运行与本次改动相关的测试（优先运行受影响的测试文件，而不是全部测试）。测试全部通过时 passed 为 true。必须输出 { passed, tests, failures }。', undefined, 'test'),
      agent('reviewer', 'Reviewer Agent', model, 'review', '审查 Git Diff、测试结果、类型安全和架构一致性（可用 git diff 查看改动）。改动符合需求且无明显问题时 passed 为 true。必须输出 { passed, issues }。', undefined, 'review'),
      {
        id: 'condition-1',
        type: 'condition',
        name: 'Passed?',
        config: {
          expression: 'variables.review.passed == true',
          trueLabel: 'true',
          falseLabel: 'false',
        },
      },
      agent('fix-agent', 'Fix Agent', codingModel, 'fixed', '根据测试和 Review 问题修改代码，并返回修复摘要。', codingExecutorId, undefined, codingTimeoutMs),
      { id: 'commit-1', type: 'tool', name: 'Git Commit', config: { toolName: 'git', input: { operation: 'commit', message: `feat(self-development): ${taskId}` } } },
      { id: 'end-1', type: 'end', name: 'End', config: {} },
    ],
    edges: [
      edge('edge-start', 'start-1', 'requirement-analyzer'),
      edge('edge-requirement', 'requirement-analyzer', 'task-decomposer'),
      edge('edge-tasks', 'task-decomposer', 'coding-agent'),
      edge('edge-coding', 'coding-agent', 'loop-1'),
      edge('edge-loop-body', 'loop-1', 'test-agent', 'body'),
      edge('edge-loop-exit', 'loop-1', 'commit-1', 'exit'),
      edge('edge-test-review', 'test-agent', 'reviewer'),
      edge('edge-review-condition', 'reviewer', 'condition-1'),
      edge('edge-condition-true', 'condition-1', 'loop-1', 'true'),
      edge('edge-condition-false', 'condition-1', 'fix-agent', 'false'),
      edge('edge-fix-loop', 'fix-agent', 'loop-1'),
      edge('edge-commit-end', 'commit-1', 'end-1'),
    ],
  };
}

function startConfig(): StartConfig {
  return {
    inputParameters: [
      { name: 'inputs', type: 'string', required: true, system: true, description: '工作流总输入。' },
      { name: 'requirement', type: 'string', required: true, description: '本次开发需求描述。' },
    ],
  };
}

function agent(
  id: string,
  name: string,
  model: string,
  outputKey: string,
  instruction: string,
  executorId?: string,
  mockRole?: string,
  timeoutMs?: number,
): WorkflowNode {
  return {
    id,
    type: 'agent',
    name,
    config: {
      model,
      systemPrompt: instruction,
      outputFormat: 'json',
      outputSchema: { type: 'object' },
      outputKey,
      ...(executorId ? { executorId } : {}),
      ...(mockRole ? { mockRole } : {}),
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    },
  } as WorkflowNode;
}

function edge(id: string, source: string, target: string, condition?: string) {
  return { id, source, target, ...(condition ? { condition } : {}) };
}
