<script setup lang="ts">
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import type { WorkflowNodeData, WorkflowNodeType } from '../../editor/workflow-graph';
const props = defineProps<NodeProps<WorkflowNodeData, object, WorkflowNodeType>>();
const descriptions: Record<WorkflowNodeType, string> = {
  start: 'Workflow entry',
  agent: 'LLM task',
  condition: 'Route by expression',
  end: 'Workflow exit',
};
</script>
<template>
  <div class="workflow-node" :class="'workflow-node--' + props.type">
    <Handle type="target" :position="Position.Top" class="workflow-handle" />
    <div class="workflow-node__icon" aria-hidden="true">
      {{ props.type.slice(0, 1).toUpperCase() }}
    </div>
    <div class="workflow-node__body">
      <strong>{{ props.data.label }}</strong
      ><span>{{ descriptions[props.type] }}</span>
    </div>
    <Handle type="source" :position="Position.Bottom" class="workflow-handle" />
  </div>
</template>
