<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  getSelfDevelopmentSessionDiff,
  listSelfDevelopmentSessions,
  runSelfDevelopment,
  type SelfDevelopmentRunResult,
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

async function startRun(): Promise<void> {
  if (!requirement.value.trim()) {
    error.value = '请先输入开发需求';
    return;
  }
  running.value = true;
  error.value = '';
  result.value = null;
  diffText.value = '';
  try {
    const taskId = 'task-' + Date.now();
    result.value = await runSelfDevelopment({
      taskId,
      requirement: requirement.value.trim(),
    });
    await refreshSessions();
    if (result.value.run.status === 'SUCCESS') await loadDiff(taskId);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Self-development 执行失败';
  } finally {
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
  return JSON.stringify(value);
};

onMounted(refreshSessions);
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
    <div v-if="error" class="monitor-error">{{ error }}</div>
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

      <section v-if="running" class="status-card">
        <div class="status-heading"><span class="status-dot" aria-hidden="true" /><span>正在执行</span></div>
        <p class="status-message">Coding Agent 正在隔离 workspace 中读取代码、修改文件并运行测试...</p>
      </section>

      <section v-if="result" class="self-dev-result">
        <div class="panel-heading">
          <span>执行结果</span>
          <span class="summary-value" :class="result.run.status === 'SUCCESS' ? 'status--success' : 'status--failed'">
            {{ result.run.status }}{{ result.merged ? ' · 已合并' : '' }}
          </span>
        </div>
        <div v-if="result.run.error" class="monitor-error">{{ result.run.error }}</div>
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
          @click="loadDiff(session.id)"
        >
          <span class="run-item__id">{{ session.id }}</span>
          <small class="run-item__time">{{ session.createdAt }} · {{ session.branch }}</small>
        </button>
      </section>
    </div>
  </main>
</template>
