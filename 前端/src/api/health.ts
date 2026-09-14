import type { HealthResponse } from '@ai-workflow/shared-types';
import { apiBaseUrl, apiFetch } from './client';

export async function getHealth(baseUrl: string = apiBaseUrl): Promise<HealthResponse> {
  const response = await apiFetch('/health', {}, baseUrl);
  if (!response.ok) throw new Error('Health check failed: ' + response.status);
  return (await response.json()) as HealthResponse;
}
