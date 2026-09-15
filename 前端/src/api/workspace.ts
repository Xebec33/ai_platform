import { apiFetch } from './client';

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface WorkspaceFileList {
  root: string;
  truncated: boolean;
  files: WorkspaceFileEntry[];
}

export interface WorkspaceFileContent {
  path: string;
  size: number;
  content: string;
}

export async function listWorkspaceFiles(): Promise<WorkspaceFileList> {
  const response = await apiFetch('/workspace/files');
  if (!response.ok) throw new Error('获取工作环境文件失败: ' + response.status);
  return (await response.json()) as WorkspaceFileList;
}

export async function readWorkspaceFile(path: string): Promise<WorkspaceFileContent> {
  const response = await apiFetch('/workspace/file?path=' + encodeURIComponent(path));
  const payload = (await response.json()) as WorkspaceFileContent & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? '读取文件失败: ' + response.status);
  return payload;
}

export async function writeWorkspaceFile(path: string, content: string): Promise<void> {
  const response = await apiFetch('/workspace/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? '保存文件失败: ' + response.status);
  }
}

export async function deleteWorkspaceFile(path: string): Promise<void> {
  const response = await apiFetch('/workspace/file?path=' + encodeURIComponent(path), {
    method: 'DELETE',
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? '删除文件失败: ' + response.status);
  }
}

export async function createWorkspaceDirectory(path: string): Promise<void> {
  const response = await apiFetch('/workspace/directory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? '创建目录失败: ' + response.status);
  }
}
