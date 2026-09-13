<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ConnectionMode, VueFlow, type Connection, type NodeMouseEvent } from '@vue-flow/core';
import { uiGraphToWorkflow } from '@ai-workflow/shared-types';
import WorkflowNode from '../nodes/WorkflowNode.vue';
import { serializeWorkflowGraph, type WorkflowNodeType } from '../../editor/workflow-graph';
import { runWorkflow } from '../../api/workflows';
import { useWorkflowEditorStore } from '../../stores/workflow-editor';

const emit = defineEmits<{ runStarted: [runId: string] }>();
const store = useWorkflowEditorStore();
const running = ref(false);
const jsonText = ref('');
const showJson = ref(false);
const nodeTypes = {
  start: WorkflowNode,
  agent: WorkflowNode,
  condition: WorkflowNode,
  end: WorkflowNode,
};
const selectedType = computed(() => store.selectedNode?.type ?? null);
const selectedConfig = computed(() => store.selectedNode?.data.config ?? {});
const nodeOptions: { type: WorkflowNodeType; label: string; hint: string }[] = [
  { type: 'start', label: 'Start', hint: '入口' },
  { type: 'agent', label: 'Agent', hint: '模型调用' },
  { type: 'condition', label: 'Condition', hint: '条件分支' },
  { type: 'end', label: 'End', hint: '出口' },
];

onMounted(store.initialize);
function onNodeClick(event: NodeMouseEvent): void {
  store.selectNode(event.node.id);
}
function onConnect(connection: Connection): void {
  store.connect(connection);
}
function exportJson(): void {
  jsonText.value = serializeWorkflowGraph(store.graph);
  showJson.value = true;
}
function importJson(): void {
  store.loadJson(jsonText.value);
  showJson.value = false;
}
function updateNumber(key: string, event: Event): void {
  store.updateSelectedConfig(key, Number((event.target as HTMLInputElement).value));
}
async function runCurrentWorkflow(): Promise<void> {
  store.error = '';
  if (!store.validation.valid) {
    store.error = store.validation.issues.map((issue) => issue.message).join('；');
    return;
  }
  running.value = true;
  try {
    const workflow = uiGraphToWorkflow(store.graph, {
      id: store.workflowId,
      name: store.workflowName,
    });
    const result = await runWorkflow(workflow);
    store.message = 'Workflow 已启动：' + result.id;
    emit('runStarted', result.id);
  } catch (cause) {
    store.error = cause instanceof Error ? cause.message : '启动 Workflow 失败';
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <main class="editor-shell">
    <header class="editor-header">
      <div>
        <p class="eyebrow">PHASE 1 · WORKFLOW EDITOR</p>
        <h1>{{ store.workflowName }}</h1>
        <p class="editor-subtitle">用可视化 Graph 编排多 Agent Workflow</p>
      </div>
      <div class="editor-actions">
        <input
          v-model="store.workflowName"
          class="workflow-name-input"
          aria-label="Workflow 名称"
        /><button type="button" class="button button--primary" @click="store.save">保存</button
        ><button
          type="button"
          class="button button--run"
          :disabled="running"
          @click="runCurrentWorkflow"
        >
          {{ running ? '运行中...' : '运行' }}</button
        ><button type="button" class="button" @click="store.load">加载</button
        ><button type="button" class="button" @click="exportJson">JSON</button>
      </div>
    </header>
    <div class="editor-content">
      <aside class="node-palette">
        <div class="panel-heading"><span>节点</span><small>点击添加</small></div>
        <button
          v-for="option in nodeOptions"
          :key="option.type"
          type="button"
          class="palette-item"
          @click="store.addNode(option.type)"
        >
          <span class="palette-icon">{{ option.label.slice(0, 1) }}</span
          ><span
            ><strong>{{ option.label }}</strong
            ><small>{{ option.hint }}</small></span
          >
        </button>
        <div class="palette-tip">拖动节点移动位置，连接 Handle 创建边，选中后按 Delete 删除。</div>
      </aside>
      <section class="flow-panel">
        <VueFlow
          v-model:nodes="store.nodes"
          v-model:edges="store.edges"
          :node-types="nodeTypes"
          :connection-mode="ConnectionMode.Strict"
          fit-view-on-init
          @connect="onConnect"
          @node-click="onNodeClick"
          @pane-click="store.clearSelection"
        ></VueFlow>
        <div v-if="store.error" class="editor-toast editor-toast--error">{{ store.error }}</div>
        <div v-else-if="store.message" class="editor-toast">
          {{ store.message }}<span v-if="store.savedAt"> · {{ store.savedAt }}</span>
        </div>
      </section>
      <aside class="config-panel">
        <div class="panel-heading">
          <span>配置</span><small v-if="selectedType">{{ selectedType }}</small>
        </div>
        <div v-if="store.selectedNode" class="config-form">
          <label
            >显示名称<input
              :value="store.selectedNode.data.label"
              @input="
                store.updateSelectedLabel(($event.target as HTMLInputElement).value)
              " /></label
          ><label>节点 ID<input :value="store.selectedNode.id" disabled /></label
          ><template v-if="selectedType === 'agent'">
            <label
              >Model<input
                :value="String(selectedConfig.model ?? '')"
                @input="
                  store.updateSelectedConfig('model', ($event.target as HTMLInputElement).value)
                " /></label
            ><label
              >System Prompt<textarea
                :value="String(selectedConfig.systemPrompt ?? '')"
                rows="5"
                @input="
                  store.updateSelectedConfig(
                    'systemPrompt',
                    ($event.target as HTMLTextAreaElement).value,
                  )
                "
              /></label
            ><label
              >Temperature<input
                type="number"
                min="0"
                max="2"
                step="0.1"
                :value="Number(selectedConfig.temperature ?? 0.7)"
                @input="updateNumber('temperature', $event)" /></label
            ><label
              >Max Tokens<input
                type="number"
                min="1"
                step="1"
                :value="Number(selectedConfig.maxTokens ?? 2048)"
                @input="updateNumber('maxTokens', $event)"
            /></label> </template
          ><template v-else-if="selectedType === 'condition'">
            <label
              >Expression<textarea
                :value="String(selectedConfig.expression ?? '')"
                rows="3"
                @input="
                  store.updateSelectedConfig(
                    'expression',
                    ($event.target as HTMLTextAreaElement).value,
                  )
                "
              /></label
            ><label
              >True Label<input
                :value="String(selectedConfig.trueLabel ?? '')"
                @input="
                  store.updateSelectedConfig('trueLabel', ($event.target as HTMLInputElement).value)
                " /></label
            ><label
              >False Label<input
                :value="String(selectedConfig.falseLabel ?? '')"
                @input="
                  store.updateSelectedConfig(
                    'falseLabel',
                    ($event.target as HTMLInputElement).value,
                  )
                "
            /></label>
          </template>
        </div>
        <div v-else class="empty-state">选择一个节点查看配置</div>
      </aside>
    </div>
    <div v-if="showJson" class="json-modal" role="dialog" aria-modal="true">
      <div class="json-card">
        <div class="panel-heading">
          <span>Workflow JSON</span
          ><button type="button" class="icon-button" @click="showJson = false">关闭</button>
        </div>
        <textarea v-model="jsonText" rows="18" spellcheck="false" />
        <div class="json-actions">
          <button
            type="button"
            class="button"
            @click="jsonText = serializeWorkflowGraph(store.graph)"
          >
            导出当前</button
          ><button type="button" class="button button--primary" @click="importJson">
            加载 JSON
          </button>
        </div>
      </div>
    </div>
  </main>
</template>
