<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { ConnectionMode, useVueFlow, VueFlow, type Connection, type NodeMouseEvent } from '@vue-flow/core';
import { uiGraphToWorkflow, workflowToUiGraph, type WorkflowDefinition } from '@ai-workflow/shared-types';
import WorkflowNode from '../nodes/WorkflowNode.vue';
import { serializeWorkflowGraph, type WorkflowNodeType } from '../../editor/workflow-graph';
import { apiFetch } from '../../api/client';
import { fetchWorkflow, listSavedWorkflows, listWorkflowDemos, runWorkflow, type SavedWorkflowSummary } from '../../api/workflows';
import { useWorkflowEditorStore } from '../../stores/workflow-editor';

const emit = defineEmits<{ runStarted: [runId: string] }>();
const store = useWorkflowEditorStore();
const FLOW_ID = 'workflow-editor';
const { fitView } = useVueFlow(FLOW_ID);
const running = ref(false);
const demos = ref<Array<{ id: string; name: string }>>([]);
const selectedDemoId = ref('');
const jsonText = ref('');
const showJson = ref(false);
const nodeTypes = { start: WorkflowNode, agent: WorkflowNode, condition: WorkflowNode, tool: WorkflowNode, loop: WorkflowNode, end: WorkflowNode };
const selectedType = computed(() => store.selectedNode?.type ?? null);
const selectedConfig = computed(() => store.selectedNode?.data.config ?? {});
const outputFields = computed(() => (Array.isArray(selectedConfig.value.outputFields) ? selectedConfig.value.outputFields : []) as Array<{ name?: string; type?: string; description?: string }>);
const toolInput = computed(() => (selectedConfig.value.input && typeof selectedConfig.value.input === 'object' ? selectedConfig.value.input : {}) as Record<string, unknown>);
const startParams = computed(() => store.startParameters());
const parameterTypes = ['string', 'number', 'boolean', 'object', 'array'];
const loopTargets = computed(() => {
  if (store.selectedNode?.type !== 'loop') return { body: '', exit: '' };
  const result = { body: '', exit: '' };
  for (const edge of store.edges) {
    if (edge.source !== store.selectedNode.id) continue;
    if (edge.sourceHandle === 'body') result.body = edge.target;
    else if (edge.sourceHandle === 'exit') result.exit = edge.target;
  }
  return result;
});
const nodeOptions: { type: WorkflowNodeType; label: string; hint: string }[] = [
  { type: 'agent', label: '大模型', hint: '提示词与结构化输出' },
  { type: 'condition', label: '条件分支', hint: '满足 / 不满足双分支' },
  { type: 'loop', label: '循环', hint: 'Loop Engineering 失败修复' },
  { type: 'tool', label: '工具', hint: '文件、Shell、Git 等' },
];
const tools = [
  { name: 'file_read', label: '文件读取', hint: '读取 workspace 内的文本文件' },
  { name: 'file_write', label: '文件写入', hint: '写入 workspace 内的文本文件' },
  { name: 'shell', label: '命令执行', hint: '执行受限的 workspace 命令' },
  { name: 'git', label: 'Git', hint: '查看状态、差异或提交' },
  { name: 'http_request', label: 'HTTP 请求', hint: '访问允许的 HTTP 服务' },
  { name: 'search', label: '内容搜索', hint: '搜索 workspace 文本内容' },
];
const toolOutputFields: Record<string, string[]> = {
  file_read: ['path', 'encoding', 'content', 'bytes'],
  file_write: ['path', 'bytes', 'written'],
  shell: ['command', 'cwd', 'stdout', 'stderr', 'exitCode', 'signal', 'timedOut', 'outputLimitExceeded'],
  git: ['operation', 'stdout', 'stderr', 'exitCode', 'signal', 'timedOut'],
  http_request: ['url', 'status', 'statusText', 'headers', 'body'],
  search: ['query', 'path', 'matches', 'truncated'],
};
const outputTypes = ['string', 'number', 'boolean', 'object', 'array'];
const missingRequiredInputs = computed(() =>
  store.graph.inputs
    .filter((input) => input.required !== false && String(store.inputValues[input.name] ?? '').trim() === '' && input.defaultValue === undefined)
    .map((input) => input.label ?? input.name),
);
const showMissingInputsModal = ref(false);
const showLoadModal = ref(false);
const savedWorkflows = ref<SavedWorkflowSummary[]>([]);
const loadingSaved = ref(false);
const loadingWorkflowId = ref('');
const relations = [
  { value: 'equals', label: '等于' },
  { value: 'not_equals', label: '不等于' },
  { value: 'greater_than', label: '大于' },
  { value: 'greater_or_equal', label: '大于等于' },
  { value: 'less_than', label: '小于' },
  { value: 'less_or_equal', label: '小于等于' },
];

onMounted(async () => {
  // VueFlow 挂载时会暂停 model watcher 直到 nextTick，同步替换节点数组会被吞掉，
  // 必须等 watcher 恢复后再恢复本地存储的图
  try {
    demos.value = await listWorkflowDemos();
  } catch {
    demos.value = [];
  }
  await nextTick();
  if (store.initialize()) {
    await nextTick();
    void fitView({ padding: 0.2, duration: 300 }).catch(() => {});
  }
});
async function loadDemo(): Promise<void> {
  if (!selectedDemoId.value) {
    store.newProject();
    await nextTick();
    await fitView({ padding: 0.2, duration: 300 });
    return;
  }
  const demo = demos.value.find((item) => item.id === selectedDemoId.value);
  if (!demo) return;
  try {
    const response = await apiFetch('/workflows/demos/' + encodeURIComponent(demo.id));
    if (!response.ok) throw new Error('Demo 加载失败');
    const workflow = (await response.json()) as WorkflowDefinition;
    store.loadJson(JSON.stringify(workflowToUiGraph(workflow)));
    await nextTick();
    await fitView({ padding: 0.2, duration: 300 });
  } catch (cause) {
    store.error = cause instanceof Error ? cause.message : 'Demo 加载失败';
  }
}
function onNodeClick(event: NodeMouseEvent): void { store.selectNode(event.node.id); }
function onConnect(connection: Connection): void { store.connect(connection); }
function exportJson(): void { jsonText.value = serializeWorkflowGraph(store.graph); showJson.value = true; }
function importJson(): void {
  store.loadJson(jsonText.value);
  showJson.value = false;
  void nextTick(() => fitView({ padding: 0.2, duration: 300 }));
}
function updateNumber(key: string, event: Event): void { store.updateSelectedConfig(key, Number((event.target as HTMLInputElement).value)); }
function updateField(index: number, key: string, value: unknown): void {
  const fields = outputFields.value.map((field) => ({ ...field }));
  const field = fields[index];
  if (!field) return;
  field[key as 'name' | 'type' | 'description'] = value as never;
  store.updateSelectedConfig('outputFields', fields);
}
function updateToolEntry(key: string, value: string): void { store.updateToolInput(key, value); }
const toolInputDescriptions = computed(() =>
  (selectedConfig.value.inputDescriptions && typeof selectedConfig.value.inputDescriptions === 'object'
    ? selectedConfig.value.inputDescriptions
    : {}) as Record<string, string>,
);
const upstreamParamGroups = computed<Array<{ label: string; options: Array<{ value: string; label: string }> }>>(() => {
  if (store.selectedNode?.type !== 'tool') return [];
  const toolId = store.selectedNode.id;
  const upstream = new Set<string>();
  const queue = [toolId];
  while (queue.length) {
    const id = queue.shift();
    if (!id) break;
    for (const edge of store.edges) {
      if (edge.target === id && edge.source !== toolId && !upstream.has(edge.source)) {
        upstream.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  const groups: Array<{ label: string; options: Array<{ value: string; label: string }> }> = [];
  for (const node of store.nodes) {
    if (!upstream.has(node.id)) continue;
    const options: Array<{ value: string; label: string }> = [];
    if (node.type === 'start') {
      const parameters = Array.isArray(node.data.config.inputParameters)
        ? (node.data.config.inputParameters as Array<{ name?: unknown; system?: unknown }>)
        : [];
      for (const parameter of parameters) {
        if (typeof parameter.name !== 'string' || !parameter.name || parameter.system) continue;
        options.push({ value: '{{variables.' + parameter.name + '}}', label: parameter.name });
      }
    } else if (node.type === 'agent') {
      if (node.data.config.outputFormat === 'json') {
        const fields = Array.isArray(node.data.config.outputFields)
          ? (node.data.config.outputFields as Array<{ name?: unknown; description?: unknown }>)
          : [];
        for (const field of fields) {
          if (typeof field.name !== 'string' || !field.name) continue;
          const description = typeof field.description === 'string' && field.description ? '（' + field.description + '）' : '';
          options.push({ value: '{{nodes.' + node.id + '.' + field.name + '}}', label: field.name + description });
        }
      } else {
        options.push({ value: '{{nodes.' + node.id + '.text}}', label: 'text' });
      }
    } else if (node.type === 'tool') {
      const fields = toolOutputFields[String(node.data.config.toolName ?? '')] ?? [];
      for (const field of fields) options.push({ value: '{{nodes.' + node.id + '.' + field + '}}', label: field });
    }
    if (options.length) groups.push({ label: (node.data.label || node.id) + '（' + node.id + '）', options });
  }
  return groups;
});
const upstreamParamValues = computed(() => new Set(upstreamParamGroups.value.flatMap((group) => group.options.map((option) => option.value))));
function updateToolEntryDescription(key: string, value: string): void {
  const descriptions = { ...toolInputDescriptions.value, [key]: value };
  store.updateSelectedConfig('inputDescriptions', descriptions);
}
function addToolInput(): void {
  const base = 'parameter';
  let index = 1;
  while (toolInput.value[base + index] !== undefined) index += 1;
  store.updateToolInput(base + index, '');
}
function renameToolInput(key: string, input: HTMLInputElement): void {
  const trimmed = input.value.trim();
  if (!trimmed || trimmed === key || toolInput.value[trimmed] !== undefined) {
    input.value = key;
    return;
  }
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(toolInput.value)) next[k === key ? trimmed : k] = v;
  const descriptions = { ...toolInputDescriptions.value };
  if (descriptions[key] !== undefined) {
    descriptions[trimmed] = descriptions[key];
    delete descriptions[key];
  }
  store.updateSelectedConfig('input', next);
  store.updateSelectedConfig('inputDescriptions', descriptions);
}
function removeToolInput(key: string): void {
  const next = { ...toolInput.value };
  delete next[key];
  const descriptions = { ...toolInputDescriptions.value };
  delete descriptions[key];
  store.updateSelectedConfig('input', next);
  store.updateSelectedConfig('inputDescriptions', descriptions);
}
function goToStartInputs(): void {
  showMissingInputsModal.value = false;
  const start = store.nodes.find((node) => node.type === 'start');
  if (start) store.selectNode(start.id);
}

async function openLoadModal(): Promise<void> {
  showLoadModal.value = true;
  loadingSaved.value = true;
  store.error = '';
  try {
    savedWorkflows.value = await listSavedWorkflows();
  } catch (cause) {
    store.error = cause instanceof Error ? cause.message : '读取已保存 Workflow 失败';
    showLoadModal.value = false;
  } finally {
    loadingSaved.value = false;
  }
}

async function loadSavedWorkflow(workflowId: string): Promise<void> {
  if (loadingWorkflowId.value) return;
  loadingWorkflowId.value = workflowId;
  try {
    const workflow = await fetchWorkflow(workflowId);
    store.loadJson(JSON.stringify(workflowToUiGraph(workflow)));
    showLoadModal.value = false;
    await nextTick();
    await fitView({ padding: 0.2, duration: 300 });
  } catch (cause) {
    store.error = cause instanceof Error ? cause.message : 'Workflow 加载失败';
  } finally {
    loadingWorkflowId.value = '';
  }
}

async function runCurrentWorkflow(): Promise<void> {
  store.error = '';
  if (!store.validation.valid) { store.error = store.validation.issues.map((issue) => issue.message).join('；'); return; }
  if (missingRequiredInputs.value.length) { showMissingInputsModal.value = true; return; }
  store.save();
  running.value = true;
  try {
    const workflow = uiGraphToWorkflow(store.graph, { id: store.workflowId, name: store.workflowName });
    const result = await runWorkflow(workflow, store.inputValues);
    store.message = 'Workflow 已启动：' + result.id;
    emit('runStarted', result.id);
  } catch (cause) { store.error = cause instanceof Error ? cause.message : '启动 Workflow 失败'; }
  finally { running.value = false; }
}
</script>

<template>
  <main class="editor-shell">
    <header class="editor-header">
      <div><p class="eyebrow">PHASE 1 · WORKFLOW EDITOR</p><h1>{{ store.workflowName }}</h1><p class="editor-subtitle">可视化编排 Workflow，修改会自动保存</p></div>
      <div class="editor-actions">
        <input v-model="store.workflowName" class="workflow-name-input" aria-label="Workflow 名称" />
        <span class="autosave-status">{{ store.autosavePending ? '保存中...' : store.savedAt ? `已保存 ${store.savedAt}` : '未保存' }}</span>
        <button type="button" class="button button--primary" @click="store.save()">保存</button>
        <button type="button" class="button" @click="openLoadModal">加载</button>
        <button type="button" class="button button--run" :disabled="running" @click="runCurrentWorkflow">{{ running ? '运行中...' : '运行' }}</button>
        <select v-model="selectedDemoId" class="demo-select" aria-label="选择 Demo" @change="loadDemo"><option value="">新项目</option><option v-for="demo in demos" :key="demo.id" :value="demo.id">{{ demo.name }}</option></select>
        <button type="button" class="button" @click="exportJson">JSON</button>
      </div>
    </header>
    <div class="editor-content">
      <aside class="node-palette">
        <div class="panel-heading"><span>节点</span><small>点击添加</small></div>
        <button v-for="option in nodeOptions" :key="option.type" type="button" class="palette-item" @click="store.addNode(option.type)"><span class="palette-icon">{{ option.label.slice(0, 1) }}</span><span><strong>{{ option.label }}</strong><small>{{ option.hint }}</small></span></button>
      </aside>
      <section class="flow-panel">
        <VueFlow :id="FLOW_ID" v-model:nodes="store.nodes" v-model:edges="store.edges" :node-types="nodeTypes" :connection-mode="ConnectionMode.Strict" fit-view-on-init @connect="onConnect" @node-click="onNodeClick" @pane-click="store.clearSelection" />
        <div v-if="store.error" class="editor-toast editor-toast--error">{{ store.error }}</div><div v-else-if="store.message" class="editor-toast">{{ store.message }}</div>
      </section>
      <aside class="config-panel">
        <div class="panel-heading"><span>配置</span><small v-if="selectedType">{{ selectedType }}</small></div>
        <div v-if="store.selectedNode" class="config-form">
          <label>显示名称<input :value="store.selectedNode.data.label" @input="store.updateSelectedLabel(($event.target as HTMLInputElement).value)" /></label>
          <label>节点 ID<input :value="store.selectedNode.id" disabled /></label>
          <template v-if="selectedType === 'agent'">
            <label>提示词<textarea :value="String(selectedConfig.systemPrompt ?? '')" rows="5" @input="store.updateSelectedConfig('systemPrompt', ($event.target as HTMLTextAreaElement).value)" /></label>
            <label>输出格式<select :value="String(selectedConfig.outputFormat ?? 'text')" @change="store.updateSelectedConfig('outputFormat', ($event.target as HTMLSelectElement).value)"><option value="text">文本</option><option value="json">JSON</option></select></label>
            <div v-if="selectedConfig.outputFormat === 'json'" class="field-list"><div class="field-list__header"><strong>JSON 输出参数</strong><button type="button" class="button button--small" @click="store.addAgentOutputField">新增参数</button></div><div v-for="(field, index) in outputFields" :key="index" class="param-item"><div class="field-row"><input :value="field.name ?? ''" placeholder="参数名称" @input="updateField(index, 'name', ($event.target as HTMLInputElement).value)" /><select :value="field.type ?? 'string'" @change="updateField(index, 'type', ($event.target as HTMLSelectElement).value)"><option v-for="type in outputTypes" :key="type" :value="type">{{ type }}</option></select><button type="button" class="icon-button" @click="store.removeAgentOutputField(index)">×</button></div><input class="param-description" :value="field.description ?? ''" placeholder="描述（供 Agent 理解该参数含义）" @input="updateField(index, 'description', ($event.target as HTMLInputElement).value)" /></div></div>
            <div v-else class="field-list"><div class="field-list__header"><strong>输出参数</strong></div><div class="param-item"><div class="field-row"><input value="text" disabled aria-label="参数名" /><input value="String" disabled aria-label="参数类型" /></div><p class="config-hint">文本输出固定写入 text 参数（String），名称与类型不可修改。</p></div></div>
            <label>模型<input :value="String(selectedConfig.model ?? '')" @input="store.updateSelectedConfig('model', ($event.target as HTMLInputElement).value)" /></label><label>Temperature<input type="number" min="0" max="2" step="0.1" :value="Number(selectedConfig.temperature ?? 0.7)" @input="updateNumber('temperature', $event)" /></label><label>Max Tokens<input type="number" min="1" step="1" :value="Number(selectedConfig.maxTokens ?? 2048)" @input="updateNumber('maxTokens', $event)" /></label>
          </template>
          <template v-else-if="selectedType === 'condition'">
            <label>参数<input :value="String(selectedConfig.parameter ?? '')" placeholder="variables.approved" @input="store.updateSelectedConfig('parameter', ($event.target as HTMLInputElement).value)" /></label><label>条件关系<select :value="String(selectedConfig.relation ?? 'equals')" @change="store.updateSelectedConfig('relation', ($event.target as HTMLSelectElement).value)"><option v-for="relation in relations" :key="relation.value" :value="relation.value">{{ relation.label }}</option></select></label><label>比较值<input :value="String(selectedConfig.comparisonValue ?? '')" @input="store.updateSelectedConfig('comparisonValue', ($event.target as HTMLInputElement).value)" /></label><p class="config-hint">下方两个输出点分别代表“满足”和“不满足”。</p>
          </template>
          <template v-else-if="selectedType === 'tool'">
            <label>工具<select :value="String(selectedConfig.toolName ?? 'file_read')" @change="store.updateSelectedConfig('toolName', ($event.target as HTMLSelectElement).value)"><option v-for="tool in tools" :key="tool.name" :value="tool.name">{{ tool.label }}（{{ tool.name }}）</option></select></label><label>输出参数名<input :value="String(selectedConfig.outputKey ?? '')" placeholder="toolResult" @input="store.updateSelectedConfig('outputKey', ($event.target as HTMLInputElement).value)" /></label><label>输出参数描述<input :value="String(selectedConfig.outputKeyDescription ?? '')" placeholder="工具输出结果的含义（可选）" @input="store.updateSelectedConfig('outputKeyDescription', ($event.target as HTMLInputElement).value)" /></label><div class="field-list"><div class="field-list__header"><strong>输入参数</strong><button type="button" class="button button--small" @click="addToolInput">新增参数</button></div><div v-for="(value, key) in toolInput" :key="key" class="param-item"><div class="field-row field-row--tool"><input class="field-key-input" :value="key" spellcheck="false" aria-label="参数名" @change="renameToolInput(key, $event.target as HTMLInputElement)" /><select :value="String(value ?? '')" @change="updateToolEntry(key, ($event.target as HTMLSelectElement).value)"><option value="">选择上游参数</option><option v-if="String(value ?? '') && !upstreamParamValues.has(String(value ?? ''))" :value="String(value ?? '')">{{ String(value) }}（当前值）</option><optgroup v-for="group in upstreamParamGroups" :key="group.label" :label="group.label"><option v-for="option in group.options" :key="option.value" :value="option.value">{{ option.label }}</option></optgroup></select><button type="button" class="icon-button" @click="removeToolInput(key)">×</button></div><input class="param-description" :value="toolInputDescriptions[key] ?? ''" placeholder="描述（该输入参数的含义）" @input="updateToolEntryDescription(key, ($event.target as HTMLInputElement).value)" /></div><p v-if="upstreamParamGroups.length === 0" class="config-hint">暂无上游参数可继承，请先将上游节点连接到本工具节点。</p></div>
          </template>
          <template v-else-if="selectedType === 'loop'">
            <label>最大迭代次数<input type="number" min="1" step="1" :value="Number(selectedConfig.maxIterations ?? 3)" @input="updateNumber('maxIterations', $event)" /></label>
            <label>停止条件<input :value="String(selectedConfig.stopCondition ?? '')" placeholder="variables.review.passed == true" @input="store.updateSelectedConfig('stopCondition', ($event.target as HTMLInputElement).value)" /></label>
            <label>循环体重试次数<input type="number" min="0" step="1" :value="Number(selectedConfig.retry ?? 0)" @input="updateNumber('retry', $event)" /></label>
            <label>循环体超时（毫秒，0 为不限制）<input type="number" min="0" step="100" :value="Number(selectedConfig.timeout ?? 0)" @input="updateNumber('timeout', $event)" /></label>
            <div class="field-list">
              <div class="field-list__header"><strong>连线目标（由画布连线决定）</strong></div>
              <p class="config-hint">循环体：{{ loopTargets.body || '未连接' }} · 出口：{{ loopTargets.exit || '未连接' }}</p>
            </div>
            <p class="config-hint">下方两个输出点分别代表“循环体”和“出口”。停止条件满足或达到最大迭代次数后退出循环。</p>
          </template>
          <template v-else-if="selectedType === 'start'">
            <p class="config-hint">输入变量定义在此配置，运行时的值会在下方填写。</p>
            <div class="field-list">
              <div class="field-list__header"><strong>输入参数</strong><button type="button" class="button button--small" @click="store.addStartParameter">新增参数</button></div>
              <div v-for="(parameter, index) in startParams" :key="index" class="start-param">
                <template v-if="parameter.system">
                  <div class="field-row"><span class="field-key">{{ parameter.name }}（系统）</span></div>
                </template>
                <template v-else>
                  <div class="field-row">
                    <input :value="parameter.name" placeholder="变量名" @input="store.updateStartParameter(index, 'name', ($event.target as HTMLInputElement).value)" />
                    <select :value="parameter.type" @change="store.updateStartParameter(index, 'type', ($event.target as HTMLSelectElement).value)"><option v-for="type in parameterTypes" :key="type" :value="type">{{ type }}</option></select>
                    <button type="button" class="icon-button" @click="store.removeStartParameter(index)">×</button>
                  </div>
                  <div class="field-row field-row--wide">
                    <label class="checkbox-label"><input type="checkbox" :checked="parameter.required !== false" @change="store.updateStartParameter(index, 'required', ($event.target as HTMLInputElement).checked)" /> 必填</label>
                    <input :value="String(store.inputValues[parameter.name] ?? '')" placeholder="运行时值" @input="store.updateInputValue(parameter.name, ($event.target as HTMLInputElement).value)" />
                  </div>
                  <input class="param-description" :value="parameter.description ?? ''" placeholder="描述（该输入参数的含义）" @input="store.updateStartParameter(index, 'description', ($event.target as HTMLInputElement).value)" />
                </template>
              </div>
            </div>
          </template>
          <p v-else class="config-hint">出口是固定节点，无需配置。</p>
        </div><div v-else class="empty-state">选择一个节点查看配置</div>
      </aside>
    </div>
    <div v-if="showJson" class="json-modal" role="dialog" aria-modal="true"><div class="json-card"><div class="panel-heading"><span>Workflow JSON</span><button type="button" class="icon-button" @click="showJson = false">关闭</button></div><textarea v-model="jsonText" rows="18" spellcheck="false" /><div class="json-actions"><button type="button" class="button" @click="jsonText = serializeWorkflowGraph(store.graph)">导出当前</button><button type="button" class="button button--primary" @click="importJson">加载 JSON</button></div></div></div>
    <div v-if="showMissingInputsModal" class="json-modal" role="dialog" aria-modal="true">
      <div class="json-card">
        <div class="panel-heading"><span>请填写必填项</span><button type="button" class="icon-button" @click="showMissingInputsModal = false">关闭</button></div>
        <p class="missing-inputs-hint">以下运行输入尚未填写：</p>
        <ul class="missing-inputs-list">
          <li v-for="name in missingRequiredInputs" :key="name">{{ name }}</li>
        </ul>
        <div class="json-actions">
          <button type="button" class="button" @click="showMissingInputsModal = false">关闭</button>
          <button type="button" class="button button--primary" @click="goToStartInputs">去填写</button>
        </div>
      </div>
    </div>
    <div v-if="showLoadModal" class="json-modal" role="dialog" aria-modal="true">
      <div class="json-card">
        <div class="panel-heading"><span>加载 Workflow</span><button type="button" class="icon-button" @click="showLoadModal = false">关闭</button></div>
        <div v-if="loadingSaved" class="empty-state">读取中...</div>
        <div v-else-if="savedWorkflows.length === 0" class="empty-state">暂无已保存的 Workflow</div>
        <div v-else class="saved-workflow-list">
          <button
            v-for="item in savedWorkflows"
            :key="item.id"
            type="button"
            class="run-item"
            :class="{ 'run-item--active': loadingWorkflowId === item.id }"
            @click="loadSavedWorkflow(item.id)"
          >
            <span class="run-item__id">{{ item.name }}</span>
            <small class="run-item__time">{{ item.id }}<template v-if="item.updatedAt"> · {{ item.updatedAt.replace('T', ' ').slice(0, 16) }}</template></small>
            <span v-if="loadingWorkflowId === item.id">加载中...</span>
          </button>
        </div>
      </div>
    </div>
  </main>
</template>
