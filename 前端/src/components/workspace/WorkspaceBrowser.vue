<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceFileEntry,
} from '../../api/workspace';

const loading = ref(false);
const error = ref('');
const root = ref('');
const truncated = ref(false);
const files = ref<WorkspaceFileEntry[]>([]);
const selected = ref<WorkspaceFileEntry | null>(null);
const filePath = ref('');
const fileContent = ref('');
const fileLoading = ref(false);
const saving = ref(false);
const isNewFile = ref(false);

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
  filePath.value = entry.path;
  isNewFile.value = false;
  fileContent.value = '';
  fileLoading.value = true;
  try {
    const result = await readWorkspaceFile(entry.path);
    fileContent.value = result.content;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取文件失败';
  } finally {
    fileLoading.value = false;
  }
}

function createFile(): void {
  const input = window.prompt('新文件路径（相对 workspace，例如 notes/todo.md）');
  const path = input?.trim();
  if (!path) return;
  selected.value = { path, name: path.split('/').pop() ?? path, type: 'file' };
  filePath.value = path;
  fileContent.value = '';
  isNewFile.value = true;
  error.value = '';
}

async function saveFile(): Promise<void> {
  if (!filePath.value.trim()) return;
  saving.value = true;
  error.value = '';
  try {
    await writeWorkspaceFile(filePath.value.trim(), fileContent.value);
    isNewFile.value = false;
    await refresh();
    selected.value = {
      path: filePath.value.trim(),
      name: filePath.value.split('/').pop() ?? filePath.value,
      type: 'file',
    };
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存文件失败';
  } finally {
    saving.value = false;
  }
}

async function removeSelectedFile(): Promise<void> {
  if (!selected.value || isNewFile.value) return;
  if (!window.confirm(`确认删除 ${selected.value.path}？`)) return;
  error.value = '';
  try {
    await deleteWorkspaceFile(selected.value.path);
    selected.value = null;
    filePath.value = '';
    fileContent.value = '';
    await refresh();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '删除文件失败';
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
        <p class="editor-subtitle">管理当前 Workspace 中的文件（Demo 输入输出与工具可访问的范围）</p>
      </div>
      <div class="editor-actions">
        <button type="button" class="button" @click="createFile">新建文件</button>
        <button type="button" class="button" :disabled="loading" @click="refresh">
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </div>
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
          <span>{{ isNewFile ? '新建文件' : '文件编辑' }}</span>
          <small v-if="selected">{{ filePath }}</small>
        </div>
        <div v-if="!selected" class="empty-state">选择左侧文件查看或编辑内容</div>
        <p v-else-if="fileLoading" class="status-message">读取中...</p>
        <template v-else>
          <div class="workspace-editor-actions">
            <label class="workspace-path-label">路径<input v-model="filePath" class="workspace-path-input" :disabled="!isNewFile" spellcheck="false" /></label>
            <button
              v-if="!isNewFile"
              type="button"
              class="icon-button workspace-delete-button"
              @click="removeSelectedFile"
            >删除文件</button>
          </div>
          <textarea
            v-model="fileContent"
            class="workspace-editor"
            spellcheck="false"
            aria-label="文件内容"
          />
          <div class="workspace-editor-actions">
            <small class="config-hint">{{ isNewFile ? '保存后文件会出现在左侧列表。' : '修改内容后点击保存。' }}</small>
            <button type="button" class="button button--primary" :disabled="saving" @click="saveFile">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </template>
      </section>
    </div>
  </main>
</template>
