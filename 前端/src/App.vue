<script setup lang="ts">
import type { HealthResponse } from '@ai-workflow/shared-types';
import { onMounted, ref } from 'vue';
import { getHealth } from './api/health';

const health = ref<HealthResponse | null>(null);
const loading = ref(true);
const error = ref('');
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
onMounted(refreshHealth);
</script>
<template>
  <main class="page-shell">
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
</template>
