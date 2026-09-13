import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  getRun,
  getRuns,
  subscribeRunEvents,
  type WorkflowRun,
  type WorkflowRunEvent,
} from '../api/runs';

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
    if (event.status && currentRun.value) {
      currentRun.value = { ...currentRun.value, status: event.status };
    }
    if (event.currentNode && currentRun.value) {
      currentRun.value = { ...currentRun.value };
    }
    if (event.type === 'RUN_COMPLETED' || event.type === 'RUN_FAILED' || event.type === 'RUN_CANCELLED') {
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
