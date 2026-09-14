<script setup lang="ts">
import type { HealthResponse } from '@ai-workflow/shared-types';
import { onMounted, ref } from 'vue';
import { getHealth } from './api/health';
import { getStoredInviteCode, storeInviteCode, verifyInviteCode } from './api/client';
import RunMonitor from './components/monitor/RunMonitor.vue';
import WorkflowEditor from './components/workflow/WorkflowEditor.vue';
import WorkspaceBrowser from './components/workspace/WorkspaceBrowser.vue';
import SelfDevelopment from './components/selfdevelopment/SelfDevelopment.vue';

const health = ref<HealthResponse | null>(null);
const loading = ref(true);
const error = ref('');
const view = ref<'home' | 'editor' | 'monitor' | 'workspace' | 'self-development'>('home');
const inviteInput = ref('');
const inviteChecking = ref(false);
const inviteError = ref('');
const unlocked = ref(false);

async function refreshHealth(): Promise<void> {
  loading.value = true;
  error.value = '';
  try { health.value = await getHealth(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '无法连接后端服务'; }
  finally { loading.value = false; }
}
async function submitInviteCode(): Promise<void> {
  if (!inviteInput.value.trim()) {
    inviteError.value = '请输入邀请码';
    return;
  }
  inviteChecking.value = true;
  inviteError.value = '';
  try {
    const valid = await verifyInviteCode(inviteInput.value.trim());
    if (!valid) {
      inviteError.value = '邀请码无效';
      return;
    }
    storeInviteCode(inviteInput.value.trim());
    unlocked.value = true;
  } catch (cause) {
    inviteError.value = cause instanceof Error ? cause.message : '校验失败';
  } finally {
    inviteChecking.value = false;
  }
}
function switchView(next: typeof view.value): void {
  if (next !== 'home' && !unlocked.value) {
    view.value = 'home';
    inviteError.value = '请先输入邀请码';
    return;
  }
  view.value = next;
}
onMounted(() => {
  refreshHealth();
  if (getStoredInviteCode()) unlocked.value = true;
});
</script>
<template>
  <nav class="app-nav" aria-label="主导航">
    <button type="button" class="nav-button" :class="{ active: view === 'home' }" @click="switchView('home')">首页</button>
    <button type="button" class="nav-button" :class="{ active: view === 'editor' }" @click="switchView('editor')">Workflow 编辑器</button>
    <button type="button" class="nav-button" :class="{ active: view === 'monitor' }" @click="switchView('monitor')">运行监控</button>
    <button type="button" class="nav-button" :class="{ active: view === 'workspace' }" @click="switchView('workspace')">工作环境</button>
    <button type="button" class="nav-button" :class="{ active: view === 'self-development' }" @click="switchView('self-development')">自举开发</button>
  </nav>
  <main v-if="view === 'home'" class="page-shell">
    <section class="hero-card">
      <p class="eyebrow">PHASE 0 · PROJECT INITIALIZATION</p><h1>AI Workflow Platform</h1><p class="subtitle">Multi-Agent 编排与 Loop Engineering 平台</p>
      <div v-if="!unlocked" class="invite-card">
        <p class="status-message">本平台仅限受邀用户使用，请输入邀请码访问</p>
        <div class="invite-row">
          <input
            v-model="inviteInput"
            class="workflow-name-input invite-input"
            type="password"
            placeholder="邀请码"
            aria-label="邀请码"
            @keyup.enter="submitInviteCode"
          />
          <button type="button" class="button button--primary" :disabled="inviteChecking" @click="submitInviteCode">
            {{ inviteChecking ? '校验中...' : '进入平台' }}
          </button>
        </div>
        <p v-if="inviteError" class="invite-error">{{ inviteError }}</p>
      </div>
      <template v-else>
        <div class="status-card" :class="{ success: health, failure: error }"><div class="status-heading"><span class="status-dot" aria-hidden="true" /><span>后端连接状态</span></div><p v-if="loading" class="status-message">正在检查后端服务...</p><p v-else-if="health" class="status-message">Backend 已连接，服务状态：{{ health.status }}</p><p v-else class="status-message">{{ error }}</p><p v-if="health" class="timestamp">最近检查：{{ health.timestamp }}</p><button type="button" class="refresh-button" :disabled="loading" @click="refreshHealth">{{ loading ? '检查中...' : '重新检查' }}</button></div>
        <p class="timestamp">已通过邀请码验证，可访问上方各功能</p>
      </template>
    </section>
  </main>
  <WorkflowEditor v-else-if="view === 'editor'" @run-started="switchView('monitor')" />
  <RunMonitor v-else-if="view === 'monitor'" />
  <WorkspaceBrowser v-else-if="view === 'workspace'" />
  <SelfDevelopment v-else />
</template>
