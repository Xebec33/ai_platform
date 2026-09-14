<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  type WorkspaceFileEntry,
} from '../../api/workspace';

const loading = ref(false);
const error = ref('');
const root = ref('');
const truncated = ref(false);
const files = ref<WorkspaceFileEntry[]>([]);
const selected = ref<WorkspaceFileEntry | null>(null);
const fileContent = ref('');
const fileLoading = ref(false);

const formatSize = (size?: number): string => {
  if (size === undefined) return '';
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / (1024 * 1024)).toFixed(1) + ' MB';
};

const sortedFiles = computed(() => {
  const depth = (path: string): number => path.split('/').length;
  return [...files.value].sort((a, b) => {
    const depthDiff = depth(a.path) - depth(b.path);
    if (depthDiff !== 0) return depthDiff;
    return a.path.localeCompare(b.path);
  });
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = await listWorkspaceFiles();
    root.value = result.root;
    truncated.value = result.truncated;
    files.value = result.files;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '获取文件列表失败';
  } finally {
    loading.value = false;
  }
}

async function openFile(entry: WorkspaceFileEntry): Promise<void> {
  if (entry.type !== 'file') return;
  selected.value = entry;
  fileContent.value = '';
  fileLoading.value = true;
  try {
    const result = await readWorkspaceFile(entry.path);
    fileContent.value = result.content;
  } catch (cause) {
    fileContent.value = cause instanceof Error ? cause.message : '读取文件失败';
  } finally {
    fileLoading.value = false;
  }
}

onMounted(refresh);
</script>

<template>
  <main class="editor-shell">
    <header class="editor-header">
      <div>
        <p class="eyebrow">WORKSPACE · 运行环境</p>
        <h1>工作环境</h1>
        <p class="editor-subtitle">查看当前 Workspace 中的文件（Demo 输入输出与工具可访问的范围）</p>
      </div>
      <button type="button" class="button" :disabled="loading" @click="refresh">
        {{ loading ? '刷新中...' : '刷新' }}
      </button>
    </header>
    <div v-if="error" class="monitor-error">{{ error }}</div>
    <div v-else class="workspace-content">
      <aside class="workspace-panel">
        <div class="panel-heading">
          <span>文件列表</span>
          <small>{{ files.length }} 项{{ truncated ? '（已截断）' : '' }}</small>
        </div>
        <p class="workspace-root">{{ root }}</p>
        <div v-if="files.length === 0 && !loading" class="empty-state">Workspace 为空</div>
        <button
          v-for="entry in sortedFiles"
          :key="entry.path"
          type="button"
          class="workspace-item"
          :class="{ 'workspace-item--active': selected?.path === entry.path }"
          :style="{ paddingLeft: 12 + (entry.path.split('/').length - 1) * 14 + 'px' }"
          @click="openFile(entry)"
        >
          <span class="workspace-item__icon">{{ entry.type === 'directory' ? '📁' : '📄' }}</span>
          <span class="workspace-item__path">{{ entry.path }}</span>
          <small class="workspace-item__size">{{ formatSize(entry.size) }}</small>
        </button>
      </aside>
      <section class="workspace-preview">
        <div class="panel-heading">
          <span>文件预览</span>
          <small v-if="selected">{{ selected.path }}</small>
        </div>
        <div v-if="!selected" class="empty-state">选择左侧文件查看内容</div>
        <p v-else-if="fileLoading" class="status-message">读取中...</p>
        <pre v-else class="workspace-file-content">{{ fileContent }}</pre>
      </section>
    </div>
  </main>
</template>
