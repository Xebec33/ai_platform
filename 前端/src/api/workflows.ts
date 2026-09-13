import type { JsonObject, WorkflowDefinition } from '@ai-workflow/shared-types';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

export async function runWorkflow(
  workflow: WorkflowDefinition,
  variables: JsonObject = {},
  baseUrl = apiBaseUrl,
): Promise<{ id: string }> {
  const response = await fetch(baseUrl + '/workflows/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow, variables }),
  });
  const payload = (await response.json()) as { id?: string; error?: string };
  if (!response.ok) throw new Error(payload.error ?? '启动 Workflow 失败: ' + response.status);
  if (!payload.id) throw new Error('后端未返回 Run ID');
  return { id: payload.id };
}
