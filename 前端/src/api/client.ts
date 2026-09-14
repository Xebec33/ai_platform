const INVITE_CODE_KEY = 'ai-workflow-platform:invite-code';

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

export function getStoredInviteCode(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(INVITE_CODE_KEY) ?? '';
}

export function storeInviteCode(code: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(INVITE_CODE_KEY, code);
}

export function clearInviteCode(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(INVITE_CODE_KEY);
}

export async function verifyInviteCode(code: string): Promise<boolean> {
  const response = await fetch(apiBaseUrl + '/auth/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (response.status === 401) return false;
  if (!response.ok) throw new Error('邀请码校验失败: ' + response.status);
  return true;
}

export function apiFetch(path: string, init: RequestInit = {}, baseUrl = apiBaseUrl): Promise<Response> {
  const code = getStoredInviteCode();
  const headers = new Headers(init.headers);
  if (code) headers.set('X-Invite-Code', code);
  return fetch(baseUrl + path, { ...init, headers });
}

export function eventSourceUrl(path: string, baseUrl = apiBaseUrl): string {
  const code = getStoredInviteCode();
  if (!code) return baseUrl + path;
  return baseUrl + path + (path.includes('?') ? '&' : '?') + 'invite_code=' + encodeURIComponent(code);
}
