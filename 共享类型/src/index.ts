export interface HealthResponse {
  status: 'ok';
  service: 'backend';
  timestamp: string;
}

export * from './workflow.js';
export * from './workflow-schema.js';
export * from './workflow-validator.js';
