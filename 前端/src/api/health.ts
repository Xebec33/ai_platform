import type { HealthResponse } from '@ai-workflow/shared-types';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

export async function getHealth(baseUrl = apiBaseUrl): Promise<HealthResponse> {
  const response = await fetch(baseUrl + '/health');
  if (!response.ok) throw new Error('Health check failed: ' + response.status);
  return (await response.json()) as HealthResponse;
}
