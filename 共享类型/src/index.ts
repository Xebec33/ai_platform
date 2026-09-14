export interface HealthResponse {
  status: 'ok';
  service: 'backend';
  version: string;
  timestamp: string;
}

export * from './workflow.js';
export * from './workflow-schema.js';
export * from './workflow-validator.js';
export * from './workflow-demos.js';
