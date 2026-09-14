export interface HealthResponse {
  status: 'ok';
  service: 'backend';
  version: string;
  timestamp: string;
  /**
   * 进程启动至今的运行时长，单位：秒（seconds）。
   * 非负数值；同一进程内单调不减；进程重启后从 0 重新计时。
   * 向后兼容的新增字段。
   */
  uptime: number;
}

export * from './workflow.js';
export * from './workflow-schema.js';
export * from './workflow-validator.js';
export * from './workflow-demos.js';
