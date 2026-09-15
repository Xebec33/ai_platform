<script setup lang="ts">
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import type { WorkflowNodeData, WorkflowNodeType } from '../../editor/workflow-graph';
const props = defineProps<NodeProps<WorkflowNodeData, object, WorkflowNodeType>>();
const descriptions: Record<WorkflowNodeType, string> = {
  start: '工作流入口',
  agent: '大模型调用',
  condition: '条件分支',
  tool: '工具调用',
  loop: '循环工程',
  end: '工作流出口',
};
</script>
<template>
  <div class="workflow-node" :class="'workflow-node--' + props.type">
    <Handle v-if="props.type !== 'start'" type="target" :position="Position.Left" class="workflow-handle" />
    <Handle v-if="props.type !== 'start'" id="top" type="target" :position="Position.Top" class="workflow-handle" />
    <Handle v-if="props.type !== 'start'" id="bottom" type="target" :position="Position.Bottom" class="workflow-handle" />
    <div class="workflow-node__icon" aria-hidden="true">
      {{ props.type.slice(0, 1).toUpperCase() }}
    </div>
    <div class="workflow-node__body">
      <strong :title="props.data.label">{{ props.data.label }}</strong>
      <span :title="descriptions[props.type]">{{ descriptions[props.type] }}</span>
    </div>
    <template v-if="props.type === 'condition'">
      <Handle id="true" type="source" :position="Position.Right" :style="{ top: '32%' }" class="workflow-handle" />
      <Handle id="false" type="source" :position="Position.Right" :style="{ top: '68%' }" class="workflow-handle" />
      <span class="workflow-node__branch-label workflow-node__branch-label--true">满足</span>
      <span class="workflow-node__branch-label workflow-node__branch-label--false">不满足</span>
    </template>
    <template v-else-if="props.type === 'loop'">
      <Handle id="body" type="source" :position="Position.Right" :style="{ top: '32%' }" class="workflow-handle" />
      <Handle id="exit" type="source" :position="Position.Right" :style="{ top: '68%' }" class="workflow-handle" />
      <span class="workflow-node__branch-label workflow-node__branch-label--true">循环体</span>
      <span class="workflow-node__branch-label workflow-node__branch-label--false">出口</span>
    </template>
    <Handle v-else-if="props.type !== 'end'" type="source" :position="Position.Right" class="workflow-handle" />
  </div>
</template>
