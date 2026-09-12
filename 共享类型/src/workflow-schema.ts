export interface JsonSchema {
  $schema: string;
  $id: string;
  title: string;
  type: 'object';
  required: string[];
  properties: Record<string, unknown>;
  $defs: Record<string, unknown>;
  additionalProperties: boolean;
}

export const workflowJsonSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ai-workflow-platform.local/schemas/workflow-v1.json',
  title: 'AI Workflow Definition',
  type: 'object',
  required: ['id', 'name', 'version', 'nodes', 'edges', 'variables'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    version: { const: 1 },
    variables: { type: 'object' },
    nodes: { type: 'array', minItems: 1, items: { $ref: '#/$defs/node' } },
    edges: { type: 'array', items: { $ref: '#/$defs/edge' } },
  },
  $defs: {
    node: {
      type: 'object',
      required: ['id', 'type', 'name', 'config'],
      properties: {
        id: { type: 'string', minLength: 1 },
        type: { enum: ['start', 'agent', 'condition', 'loop', 'end'] },
        name: { type: 'string', minLength: 1 },
        config: { type: 'object' },
      },
      additionalProperties: false,
    },
    edge: {
      type: 'object',
      required: ['id', 'source', 'target'],
      properties: {
        id: { type: 'string', minLength: 1 },
        source: { type: 'string', minLength: 1 },
        target: { type: 'string', minLength: 1 },
        condition: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
  },
};

export const workflowSchema = workflowJsonSchema;
