<script setup lang="ts">
import type { HealthResponse } from '@ai-workflow/shared-types';
import { onMounted, ref } from 'vue';
import { getHealth } from './api/health';
import RunMonitor from './components/monitor/RunMonitor.vue';
import WorkflowEditor from './components/workflow/WorkflowEditor.vue';

const health = ref<HealthResponse | null>(null);
const loading = ref(true);
const error = ref('');
const view = ref<'home' | 'editor' | 'monitor'>('home');

async function refreshHealth(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    health.value = await getHealth();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法连接后端服务';
  } finally {
    loading.value = false;
  }
}

function openMonitor(): void {
  view.value = 'monitor';
}

onMounted(refreshHealth);
</script>
<template>
  <nav class="app-nav" aria-label="主导航">
    <button
      type="button"
      class="nav-button"
      :class="{ active: view === 'home' }"
      @click="view = 'home'"
    >
      首页
    </button>
    <button
      type="button"
      class="nav-button"
      :class="{ active: view === 'editor' }"
      @click="view = 'editor'"
    >
      Workflow 编辑器
    </button>
    <button
      type="button"
      class="nav-button"
      :class="{ active: view === 'monitor' }"
      @click="view = 'monitor'"
    >
      运行监控
    </button>
  </nav>
  <main v-if="view === 'home'" class="page-shell">
    <section class="hero-card">
      <p class="eyebrow">PHASE 0 · PROJECT INITIALIZATION</p>
      <h1>AI Workflow Platform</h1>
      <p class="subtitle">Multi-Agent 编排与 Loop Engineering 平台</p>
      <div class="status-card" :class="{ success: health, failure: error }">
        <div class="status-heading">
          <span class="status-dot" aria-hidden="true" /><span>后端连接状态</span>
        </div>
        <p v-if="loading" class="status-message">正在检查后端服务...</p>
        <p v-else-if="health" class="status-message">
          Backend 已连接，服务状态：{{ health.status }}
        </p>
        <p v-else class="status-message">
          {{ error }}
        </p>
        <p v-if="health" class="timestamp">最近检查：{{ health.timestamp }}</p>
        <button type="button" class="refresh-button" :disabled="loading" @click="refreshHealth">
          {{ loading ? '检查中...' : '重新检查' }}
        </button>
      </div>
    </section>
  </main>
  <WorkflowEditor v-else-if="view === 'editor'" @run-started="openMonitor" />
  <RunMonitor v-else />
</template>
