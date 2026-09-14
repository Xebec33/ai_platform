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
