import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  getRun,
  getRuns,
  subscribeRunEvents,
  type WorkflowRun,
  type WorkflowRunEvent,
} from '../api/runs';

export function applyRunEvent(run: WorkflowRun, event: WorkflowRunEvent): WorkflowRun {
  const nodeRuns = [...run.nodeRuns];
  if (event.nodeRun) {
    const index = nodeRuns.findIndex((item) => item.id === event.nodeRun?.id);
    const existing = index >= 0 ? nodeRuns[index] : undefined;
    if (existing && index >= 0) nodeRuns[index] = { ...existing, ...event.nodeRun };
    else nodeRuns.push({ ...event.nodeRun });
  } else if (event.nodeId && event.type === 'LOOP_ITERATION') {
    for (let index = 0; index < nodeRuns.length; index += 1) {
      const existing = nodeRuns[index];
      if (existing?.nodeId === event.nodeId)
        nodeRuns[index] = { ...existing, iteration: event.iteration };
    }
  }

  return {
    ...run,
    ...(event.status ? { status: event.status } : {}),
    ...(event.output ? { output: event.output } : {}),
    ...(event.error ? { error: event.error, errorCode: event.errorCode } : {}),
    nodeRuns,
    iterations:
      event.nodeId && event.iteration !== undefined
        ? { ...run.iterations, [event.nodeId]: event.iteration }
        : run.iterations,
    ...(event.type === 'RUN_COMPLETED' ||
    event.type === 'RUN_FAILED' ||
    event.type === 'RUN_CANCELLED'
      ? { finishedAt: event.timestamp }
      : {}),
  };
}

export const useRunMonitorStore = defineStore('run-monitor', () => {
  const runs = ref<WorkflowRun[]>([]);
  const currentRun = ref<WorkflowRun | null>(null);
  const events = ref<WorkflowRunEvent[]>([]);
  const loading = ref(false);
  const error = ref('');
  let eventSource: EventSource | null = null;

  async function refreshRuns(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      runs.value = await getRuns();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '获取 Run 列表失败';
    } finally {
      loading.value = false;
    }
  }

  async function selectRun(runId: string): Promise<void> {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    events.value = [];
    error.value = '';
    try {
      currentRun.value = await getRun(runId);
      eventSource = subscribeRunEvents(runId, handleEvent, handleEventError);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '获取 Run 详情失败';
    }
  }

  function handleEvent(event: WorkflowRunEvent): void {
    events.value.push(event);
    if (!currentRun.value) return;

    currentRun.value = applyRunEvent(currentRun.value, event);
    const matchingRun = runs.value.find((run) => run.id === currentRun.value?.id);
    if (matchingRun) Object.assign(matchingRun, currentRun.value);
    if (
      event.type === 'RUN_COMPLETED' ||
      event.type === 'RUN_FAILED' ||
      event.type === 'RUN_CANCELLED'
    ) {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    }
  }

  function handleEventError(): void {
    // SSE errors are expected when the stream closes; no action needed
  }

  function clearSelection(): void {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    currentRun.value = null;
    events.value = [];
    error.value = '';
  }

  return {
    runs,
    currentRun,
    events,
    loading,
    error,
    refreshRuns,
    selectRun,
    clearSelection,
  };
});
