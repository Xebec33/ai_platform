import type { JsonObject, WorkflowDefinition } from '@ai-workflow/shared-types';
import { apiFetch } from './client';

export async function listWorkflowDemos(): Promise<WorkflowDefinition[]> {
  const response = await apiFetch('/workflows/demos');
  if (!response.ok) throw new Error('读取 Demo Workflow 失败: ' + response.status);
  return (await response.json()) as WorkflowDefinition[];
}

export interface SavedWorkflowSummary {
  id: string;
  name: string;
  updatedAt: string | null;
}

export async function listSavedWorkflows(): Promise<SavedWorkflowSummary[]> {
  const response = await apiFetch('/workflows');
  if (!response.ok) throw new Error('读取已保存 Workflow 失败: ' + response.status);
  return (await response.json()) as SavedWorkflowSummary[];
}

export async function fetchWorkflow(workflowId: string): Promise<WorkflowDefinition> {
  const response = await apiFetch('/workflows/' + encodeURIComponent(workflowId));
  if (!response.ok) throw new Error('读取 Workflow 失败: ' + response.status);
  return (await response.json()) as WorkflowDefinition;
}

export async function saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
  const response = await apiFetch('/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? 'Workflow 保存失败: ' + response.status);
  }
}

export async function runWorkflow(
  workflow: WorkflowDefinition,
  variables: JsonObject = {},
): Promise<{ id: string }> {
  const response = await apiFetch('/workflows/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow, variables }),
  });
  const payload = (await response.json()) as { id?: string; error?: string };
  if (!response.ok) throw new Error(payload.error ?? '启动 Workflow 失败: ' + response.status);
  if (!payload.id) throw new Error('后端未返回 Run ID');
  return { id: payload.id };
}
