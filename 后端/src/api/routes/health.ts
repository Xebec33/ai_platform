import type { HealthResponse } from '@ai-workflow/shared-types';
import type { FastifyInstance } from 'fastify';

/**
 * 计算从进程启动到当前时刻的运行时长，单位：秒。
 * 返回值始终为非负数值；服务重启后启动时间戳会重新采集，因此从 0 重新计时。
 */
export function computeUptimeSeconds(startedAtMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, (nowMs - startedAtMs) / 1000);
}

const processStartedAtMs = Date.now() - process.uptime() * 1000;

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: computeUptimeSeconds(processStartedAtMs),
  }));
}
