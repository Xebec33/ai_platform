import type { JsonObject } from '@ai-workflow/shared-types';
import { optionalString, requiredString, toolFailure, type Tool, type ToolExecutionContext, type ToolExecutionResult } from './types.js';

export class DemoFixtureTool implements Tool {
  readonly name = 'demo_fixture';
  readonly description = '为内置业务 Demo 提供可重复的订单、告警和工单模拟能力';
  readonly inputSchema: JsonObject = {
    type: 'object',
    required: ['operation'],
    properties: {
      operation: { type: 'string', enum: ['send_alert', 'create_ticket', 'get_order', 'retry_fulfillment'] },
      orderId: { type: 'string' },
      userId: { type: 'string' },
      kind: { type: 'string' },
      category: { type: 'string' },
      priority: { type: 'string' },
      assignedTeam: { type: 'string' },
      reply: { type: 'string' },
      message: { type: 'string' },
    },
    additionalProperties: true,
  };

  async execute(input: JsonObject, _context: ToolExecutionContext): Promise<ToolExecutionResult> {
    void _context;
    try {
      const operation = requiredString(input, 'operation');
      switch (operation) {
        case 'send_alert':
          return { ok: true, output: { sent: true, channel: 'demo-alert', message: optionalString(input, 'message') ?? '' } };
        case 'create_ticket':
          return {
            ok: true,
            output: {
              ticketId: `ticket-${stableSuffix(input)}`,
              kind: optionalString(input, 'kind') ?? 'normal',
              category: optionalString(input, 'category') ?? 'general',
              priority: optionalString(input, 'priority') ?? 'normal',
              assignedTeam: optionalString(input, 'assignedTeam') ?? '客服团队',
              reply: optionalString(input, 'reply') ?? '工单已创建。',
            },
          };
        case 'get_order': {
          const orderId = requiredString(input, 'orderId');
          return { ok: true, output: { orderId, status: 'PAID', paymentStatus: 'SUCCESS', shippingStatus: 'NOT_SHIPPED', createdAt: '2026-09-14T10:00:00Z', lastUpdatedAt: '2026-09-14T10:05:00Z' } };
        }
        case 'retry_fulfillment':
          return { ok: true, output: { success: true, retryId: `retry-${stableSuffix(input)}` } };
        default:
          return toolFailure('INVALID_INPUT', `不支持的 Demo operation：${operation}`);
      }
    } catch (error) {
      return toolFailure('DEMO_FIXTURE_ERROR', error);
    }
  }
}

function stableSuffix(input: JsonObject): string {
  const text = JSON.stringify(input);
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36).slice(0, 8);
}
