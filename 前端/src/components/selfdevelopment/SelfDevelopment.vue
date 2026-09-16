<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  getSelfDevelopmentProgress,
  getSelfDevelopmentSessionDiff,
  listSelfDevelopmentSessions,
  runSelfDevelopment,
  type SelfDevelopmentProgress,
  type SelfDevelopmentRunResult,
  type SelfDevelopmentSessionResult,
  type SelfDevelopmentWorkspace,
} from '../../api/self-development';

const requirement = ref('');
const running = ref(false);
const error = ref('');
const result = ref<SelfDevelopmentRunResult | null>(null);
const sessions = ref<SelfDevelopmentWorkspace[]>([]);
const sessionsUnavailable = ref(false);
const diffText = ref('');
const diffLoading = ref(false);
const sessionResult = ref<SelfDevelopmentSessionResult | null>(null);
const activeSessionId = ref('');
const progress = ref<SelfDevelopmentProgress | null>(null);
const activeTaskId = ref('');
let progressTimer: ReturnType<typeof setInterval> | undefined;

const phaseLabel: Record<string, string> = {
  RUNNING: '执行中',
  SUCCESS: '执行完成',
  FAILED: '执行失败',
  CANCELLED: '已取消',
  MERGING: '合并代码中',
  MERGED: '已合并',
  MERGE_FAILED: '合并失败',
};

const nodeLabel: Record<string, string> = {
  'start-1': '开始',
  'requirement-analyzer': '需求分析',
  'task-decomposer': '任务拆解',
  'coding-agent': 'Coding Agent',
  'loop-1': '测试/审查循环',
  'test-agent': '测试',
  reviewer: '审查',
  'condition-1': '是否通过',
  'fix-agent': '修复',
  'commit-1': 'Git 提交',
  'end-1': '完成',
};

const mergeErrorHints: Record<string, string> = {
  BASE_WORKTREE_DIRTY: '基础仓库存在未提交的修改。请先提交（git commit）当前改动，开发结果仍保留在会话中，之后可重新运行或手动合并。',
  BASE_BRANCH_NOT_CHECKED_OUT: '基础仓库当前检出的分支不是配置的基础分支，请切换回基础分支后重试。',
};

function startProgressPolling(taskId: string): void {
  stopProgressPolling();
  const poll = async (): Promise<void> => {
    try {
      progress.value = await getSelfDevelopmentProgress(taskId);
    } catch {
      // 轮询失败不中断运行，下次继续
    }
  };
  void poll();
  progressTimer = setInterval(poll, 1500);
}

function stopProgressPolling(): void {
  if (progressTimer !== undefined) {
    clearInterval(progressTimer);
    progressTimer = undefined;
  }
}

async function startRun(): Promise<void> {
  if (!requirement.value.trim()) {
    error.value = '请先输入开发需求';
    return;
  }
  running.value = true;
  error.value = '';
  result.value = null;
  diffText.value = '';
  progress.value = null;
  const taskId = 'task-' + Date.now();
  activeTaskId.value = taskId;
  startProgressPolling(taskId);
  try {
    result.value = await runSelfDevelopment({
      taskId,
      requirement: requirement.value.trim(),
    });
    await refreshSessions();
    if (result.value.run.status === 'SUCCESS') await loadDiff(taskId);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Self-development 执行失败';
  } finally {
    stopProgressPolling();
    if (activeTaskId.value === taskId) {
      try {
        progress.value = await getSelfDevelopmentProgress(taskId);
      } catch {
        // 保留最后一次成功轮询的进度
      }
    }
    running.value = false;
  }
}

async function refreshSessions(): Promise<void> {
  try {
    sessions.value = await listSelfDevelopmentSessions();
    sessionsUnavailable.value = false;
  } catch {
    sessionsUnavailable.value = true;
  }
}

async function loadDiff(taskId: string): Promise<void> {
  diffLoading.value = true;
  try {
    const detail = await getSelfDevelopmentSessionDiff(taskId);
    diffText.value = detail.diff.diff || detail.diff.status || '（无变更）';
    sessionResult.value = detail.result ?? null;
    activeSessionId.value = taskId;
  } catch {
    diffText.value = '';
  } finally {
    diffLoading.value = false;
  }
}

const summary = (output?: Record<string, unknown>): string => {
  if (!output) return '';
  const value = output.summary ?? output.passed ?? output.issues ?? output.goals;
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  return JSON.stringify(value);
};

interface CodingStep {
  type: string;
  text: string;
}

const codingSteps = (output?: Record<string, unknown>): CodingStep[] => {
  if (!output) return [];
  const events = Array.isArray(output.events) ? output.events : [];
  const steps: CodingStep[] = [];
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue;
    const record = event as Record<string, unknown>;
    const part = record.part as Record<string, unknown> | undefined;
    const type = typeof record.type === 'string' ? record.type : '';
    if (type === 'step_start') steps.push({ type: 'step', text: '执行步骤开始' });
    else if (type === 'text' && typeof part?.text === 'string' && part.text.trim())
      steps.push({ type: 'text', text: part.text });
    else if (type === 'tool' && part && typeof part.tool === 'string')
      steps.push({ type: 'tool', text: '调用工具：' + part.tool });
  }
  return steps;
};

const detailJson = (value: unknown): string => JSON.stringify(value, null, 2);

onMounted(refreshSessions);
onBeforeUnmount(stopProgressPolling);
</script>

<template>
  <main class="editor-shell">
    <header class="editor-header">
      <div>
        <p class="eyebrow">SELF-DEVELOPMENT · 自举开发</p>
        <h1>平台自举开发</h1>
        <p class="editor-subtitle">输入需求，平台通过自身的 Agent 工作流完成开发并合并代码</p>
      </div>
    </header>
    <div v-if="error" class="monitor-error">
      {{ error }}
      <p v-if="error.includes('BASE_WORKTREE_DIRTY')" class="monitor-error__hint">
        {{ mergeErrorHints.BASE_WORKTREE_DIRTY }}
      </p>
    </div>
    <div class="self-dev-content">
      <section class="self-dev-form panel-heading-wide">
        <label class="config-form">
          <span class="summary-label">开发需求</span>
          <textarea
            v-model="requirement"
            rows="4"
            placeholder="例如：给 GET /health 响应增加 version 字段并补充测试"
            :disabled="running"
          />
          <button
            type="button"
            class="button button--run"
            :disabled="running"
            @click="startRun"
          >
            {{ running ? '开发中（可能需要数分钟）...' : '启动自举开发' }}
          </button>
        </label>
      </section>

      <section v-if="running || (progress && result === null)" class="status-card">
        <div class="status-heading">
          <span class="status-dot" :class="{ 'status-dot--idle': !running }" aria-hidden="true" />
          <span>{{ phaseLabel[progress?.phase ?? 'RUNNING'] ?? '正在执行' }}</span>
          <small v-if="progress?.iteration" class="status-iteration">循环第 {{ progress.iteration }} 轮</small>
        </div>
        <div v-if="!progress" class="status-message">正在启动隔离 workspace...</div>
        <div v-else class="progress-nodes">
          <div
            v-for="nodeRun in progress.nodeRuns"
            :key="nodeRun.id"
            class="progress-node"
            :class="{
              'progress-node--running': nodeRun.nodeId === progress.currentNode && running,
              'progress-node--failed': nodeRun.status === 'FAILED',
            }"
          >
            <span class="progress-node__icon">{{
              nodeRun.status === 'FAILED' ? '✗' : nodeRun.nodeId === progress.currentNode && running ? '⏳' : '✓'
            }}</span>
            <span class="progress-node__label">{{ nodeLabel[nodeRun.nodeId] ?? nodeRun.nodeId }}</span>
            <small class="progress-node__detail">
              {{ nodeRun.status === 'FAILED' ? (nodeRun.error ?? '失败') : nodeRun.nodeId === progress.currentNode && running ? '执行中...' : summary(nodeRun.output) || '完成' }}
            </small>
          </div>
        </div>
        <p v-if="progress?.error" class="monitor-error">{{ progress.error }}</p>
      </section>

      <section v-if="result" class="self-dev-result">
        <div class="panel-heading">
          <span>执行结果</span>
          <span class="summary-value" :class="result.run.status === 'SUCCESS' ? 'status--success' : 'status--failed'">
            {{ result.run.status }}{{ result.merged ? ' · 已合并' : '' }}
          </span>
        </div>
        <div v-if="result.run.error" class="monitor-error">
          {{ result.run.error }}
          <p v-if="mergeErrorHints[result.run.errorCode ?? '']" class="monitor-error__hint">
            {{ mergeErrorHints[result.run.errorCode ?? ''] }}
          </p>
        </div>
        <div v-for="nodeRun in result.run.nodeRuns" :key="nodeRun.id" class="node-run-row">
          <span class="node-run__icon" :class="nodeRun.status === 'SUCCESS' ? 'status--success' : 'status--failed'">
            {{ nodeRun.status === 'SUCCESS' ? '✓' : '✗' }}
          </span>
          <div class="node-run__body">
            <div class="node-run__header">
              <strong>{{ nodeLabel[nodeRun.nodeId] ?? nodeRun.nodeId }}</strong>
              <small class="node-run__node-id">{{ nodeRun.nodeId }}</small>
            </div>
            <div v-if="nodeRun.error" class="node-run__error">{{ nodeRun.error }}</div>
            <div v-else-if="summary(nodeRun.output)" class="node-run__output">
              <pre>{{ summary(nodeRun.output) }}</pre>
            </div>
            <details v-if="nodeRun.output" class="node-run__details">
              <summary>输出详情</summary>
              <pre class="node-run__json">{{ detailJson(nodeRun.output) }}</pre>
            </details>
            <details v-if="codingSteps(nodeRun.output).length" class="node-run__details">
              <summary>执行过程（{{ codingSteps(nodeRun.output).length }} 步）</summary>
              <div class="coding-steps">
                <div
                  v-for="(step, index) in codingSteps(nodeRun.output)"
                  :key="index"
                  class="coding-step"
                  :class="'coding-step--' + step.type"
                >{{ step.text }}</div>
              </div>
            </details>
          </div>
        </div>
        <div v-if="diffLoading" class="empty-state">加载变更 Diff...</div>
        <div v-else-if="diffText" class="diff-section">
          <h3>代码变更（Git Diff）</h3>
          <pre class="run-output">{{ diffText }}</pre>
        </div>
      </section>

      <section class="self-dev-sessions">
        <div class="panel-heading">
          <span>开发会话</span>
          <small>{{ sessions.length }} 条</small>
        </div>
        <p v-if="sessionsUnavailable" class="empty-state">Self-development 未启用（需要在后端配置 SELF_DEVELOPMENT_ENABLED=true）</p>
        <div v-else-if="sessions.length === 0" class="empty-state">暂无开发会话</div>
        <button
          v-for="session in sessions"
          :key="session.id"
          type="button"
          class="run-item"
          :class="{ 'run-item--active': activeSessionId === session.id }"
          @click="loadDiff(session.id)"
        >
          <span class="run-item__id">{{ session.id }}</span>
          <small class="run-item__time">{{ session.createdAt }} · {{ session.branch }}</small>
        </button>
      </section>

      <section v-if="sessionResult" class="self-dev-result">
        <div class="panel-heading">
          <span>会话执行记录：{{ activeSessionId }}</span>
          <span class="summary-value" :class="sessionResult.run.status === 'SUCCESS' ? 'status--success' : 'status--failed'">
            {{ sessionResult.run.status }}{{ sessionResult.merged ? ' · 已合并' : '' }}
          </span>
        </div>
        <div v-if="sessionResult.mergeError" class="monitor-error">
          {{ sessionResult.mergeError }}
          <p class="monitor-error__hint">开发结果仍保留在会话 workspace 中，可查看下方 Diff。</p>
        </div>
        <div v-if="sessionResult.run.error" class="monitor-error">{{ sessionResult.run.error }}</div>
        <div v-for="nodeRun in sessionResult.run.nodeRuns" :key="nodeRun.id" class="node-run-row">
          <span class="node-run__icon" :class="nodeRun.status === 'SUCCESS' ? 'status--success' : 'status--failed'">
            {{ nodeRun.status === 'SUCCESS' ? '✓' : '✗' }}
          </span>
          <div class="node-run__body">
            <div class="node-run__header">
              <strong>{{ nodeLabel[nodeRun.nodeId] ?? nodeRun.nodeId }}</strong>
              <small class="node-run__node-id">{{ nodeRun.nodeId }}</small>
            </div>
            <div v-if="nodeRun.error" class="node-run__error">{{ nodeRun.error }}</div>
            <div v-else-if="summary(nodeRun.output)" class="node-run__output">
              <pre>{{ summary(nodeRun.output) }}</pre>
            </div>
            <details v-if="nodeRun.output" class="node-run__details">
              <summary>输出详情</summary>
              <pre class="node-run__json">{{ detailJson(nodeRun.output) }}</pre>
            </details>
            <details v-if="codingSteps(nodeRun.output).length" class="node-run__details">
              <summary>执行过程（{{ codingSteps(nodeRun.output).length }} 步）</summary>
              <div class="coding-steps">
                <div
                  v-for="(step, index) in codingSteps(nodeRun.output)"
                  :key="index"
                  class="coding-step"
                  :class="'coding-step--' + step.type"
                >{{ step.text }}</div>
              </div>
            </details>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
