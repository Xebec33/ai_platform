import type { JsonObject } from '@ai-workflow/shared-types';
import { apiFetch } from './client';

export interface SelfDevelopmentWorkspace {
  id: string;
  repositoryRoot: string;
  path: string;
  baseBranch: string;
  branch: string;
  createdAt: string;
}

export interface SelfDevelopmentRunResult {
  workspace: SelfDevelopmentWorkspace;
  run: {
    status: string;
    error?: string;
    errorCode?: string;
    variables: JsonObject;
    nodeRuns: Array<{
      id: string;
      nodeId: string;
      status: string;
      startedAt: string;
      finishedAt?: string;
      error?: string;
      output?: JsonObject;
    }>;
  };
  merged: boolean;
  mergeOutput?: string;
}

export interface SelfDevelopmentSessionDiff {
  workspace: SelfDevelopmentWorkspace;
  diff: { status: string; diff: string };
}

export async function runSelfDevelopment(payload: {
  taskId: string;
  requirement: string;
  model?: string;
  codingModel?: string;
  maxIterations?: number;
}): Promise<SelfDevelopmentRunResult> {
  const response = await apiFetch('/self-development/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as SelfDevelopmentRunResult & { error?: string };
  if (!response.ok && !result.run)
    throw new Error(result.error ?? 'Self-development 执行失败: ' + response.status);
  return result;
}

export async function listSelfDevelopmentSessions(): Promise<SelfDevelopmentWorkspace[]> {
  const response = await apiFetch('/self-development/sessions');
  if (!response.ok) throw new Error('获取开发会话失败: ' + response.status);
  return (await response.json()) as SelfDevelopmentWorkspace[];
}

export async function getSelfDevelopmentSessionDiff(
  taskId: string,
): Promise<SelfDevelopmentSessionDiff> {
  const response = await apiFetch('/self-development/sessions/' + encodeURIComponent(taskId));
  const result = (await response.json()) as SelfDevelopmentSessionDiff & { error?: string };
  if (!response.ok) throw new Error(result.error ?? '获取 Diff 失败: ' + response.status);
  return result;
}
