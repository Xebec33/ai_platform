<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRunMonitorStore } from '../../stores/run-monitor';

const store = useRunMonitorStore();

const statusClass = (status: string): string => 'status--' + status.toLowerCase();

const duration = (startedAt: string, finishedAt?: string): string => {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm';
};

const sortedNodeRuns = computed(() => {
  if (!store.currentRun) return [];
  return [...store.currentRun.nodeRuns].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
});

const eventLabel: Record<string, string> = {
  RUN_STARTED: 'Run 启动',
  NODE_STARTED: '节点开始',
  NODE_COMPLETED: '节点完成',
  NODE_FAILED: '节点失败',
  LOOP_STARTED: 'Loop 启动',
  LOOP_ITERATION: 'Loop 迭代',
  LOOP_CONTINUED: 'Loop 继续',
  LOOP_STOPPED: 'Loop 停止',
  RUN_COMPLETED: 'Run 完成',
  RUN_FAILED: 'Run 失败',
  RUN_CANCELLED: 'Run 取消',
};

function selectRun(runId: string): void {
  store.selectRun(runId);
}

onMounted(store.refreshRuns);
onUnmounted(() => store.clearSelection());
</script>

<template>
  <main class="monitor-shell">
    <header class="monitor-header">
      <div>
        <p class="eyebrow">PHASE 7 · EXECUTION MONITOR</p>
        <h1>运行监控</h1>
        <p class="monitor-subtitle">实时查看 Workflow 运行状态</p>
      </div>
      <button type="button" class="button" :disabled="store.loading" @click="store.refreshRuns">
        {{ store.loading ? '刷新中...' : '刷新列表' }}
      </button>
    </header>

    <div v-if="store.error" class="monitor-error">{{ store.error }}</div>

    <div class="monitor-content">
      <aside class="run-list-panel">
        <div class="panel-heading">
          <span>Run 列表</span><small>{{ store.runs.length }} 条</small>
        </div>
        <div v-if="store.runs.length === 0" class="empty-state">暂无运行记录</div>
        <button
          v-for="run in store.runs"
          :key="run.id"
          type="button"
          class="run-item"
          :class="{ 'run-item--active': store.currentRun?.id === run.id }"
          @click="selectRun(run.id)"
        >
          <span class="run-item__id">{{ run.id }}</span>
          <span class="run-item__status" :class="statusClass(run.status)">{{ run.status }}</span>
          <small class="run-item__time">{{ run.startedAt }}</small>
        </button>
      </aside>

      <section v-if="store.currentRun" class="run-detail-panel">
        <div class="panel-heading">
          <span>Run 详情</span>
          <small>{{ store.currentRun.id }}</small>
        </div>
        <div class="run-summary">
          <div class="summary-item">
            <span class="summary-label">状态</span>
            <span class="summary-value" :class="statusClass(store.currentRun.status)">
              {{ store.currentRun.status }}
            </span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Workflow</span>
            <span class="summary-value">{{ store.currentRun.workflowId }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">开始时间</span>
            <span class="summary-value">{{ store.currentRun.startedAt }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">持续时间</span>
            <span class="summary-value">
              {{ duration(store.currentRun.startedAt, store.currentRun.finishedAt) }}
            </span>
          </div>
          <div v-if="store.currentRun.error" class="summary-item summary-item--error">
            <span class="summary-label">错误</span>
            <span class="summary-value">{{ store.currentRun.error }}</span>
          </div>
        </div>

        <div class="node-runs-section">
          <h3>节点执行</h3>
          <div v-if="sortedNodeRuns.length === 0" class="empty-state">暂无节点执行记录</div>
          <div v-for="nodeRun in sortedNodeRuns" :key="nodeRun.id" class="node-run-row">
            <span class="node-run__icon" :class="statusClass(nodeRun.status)">
              {{
                nodeRun.status === 'SUCCESS'
                  ? '✓'
                  : nodeRun.status === 'FAILED'
                    ? '✗'
                    : nodeRun.status === 'RUNNING'
                      ? '●'
                      : '○'
              }}
            </span>
            <div class="node-run__body">
              <div class="node-run__header">
                <strong>{{ nodeRun.nodeId }}</strong>
                <span class="node-run__status" :class="statusClass(nodeRun.status)">{{
                  nodeRun.status
                }}</span>
                <small v-if="nodeRun.iteration !== undefined" class="node-run__iteration">
                  迭代 {{ nodeRun.iteration }}
                </small>
              </div>
              <small class="node-run__duration">
                {{ duration(nodeRun.startedAt, nodeRun.finishedAt) }}
              </small>
              <div v-if="nodeRun.output" class="node-run__output">
                <details>
                  <summary>输出</summary>
                  <pre>{{ JSON.stringify(nodeRun.output, null, 2) }}</pre>
                </details>
              </div>
              <div v-if="nodeRun.error" class="node-run__error">{{ nodeRun.error }}</div>
            </div>
          </div>
        </div>

        <div class="events-section">
          <h3>实时事件</h3>
          <div v-if="store.events.length === 0" class="empty-state">等待事件...</div>
          <div v-for="event in store.events.slice().reverse()" :key="event.id" class="event-row">
            <span class="event-row__type">{{ eventLabel[event.type] ?? event.type }}</span>
            <small class="event-row__time">{{ event.timestamp }}</small>
            <small v-if="event.nodeId" class="event-row__node">{{ event.nodeId }}</small>
          </div>
        </div>

        <div v-if="store.currentRun.output" class="run-output-section">
          <h3>Run 输出</h3>
          <pre class="run-output">{{ JSON.stringify(store.currentRun.output, null, 2) }}</pre>
        </div>
      </section>

      <section v-else class="run-detail-panel">
        <div class="empty-state">选择左侧的 Run 查看详情</div>
      </section>
    </div>
  </main>
</template>
