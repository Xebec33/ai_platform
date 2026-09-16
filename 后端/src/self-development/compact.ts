import type { WorkflowNodeRun, WorkflowRunResult } from '../workflow/runtime/types.js';
import type { DevelopmentSessionResult } from './session.js';

// HTTP 响应瘦身：完整数据仍保留在内存与 result.json 中，
// 这里仅剔除/截断详情页用不到的大字段（nodeRun.input、checkpoints、events 明细等），
// 避免单次响应达到数 MB 导致前端加载卡顿。

const MAX_FIELD_BYTES = 16 * 1024;
const MAX_STEP_TEXT = 400;
const MAX_EVENTS = 200;

export function compactRunResult(result: DevelopmentSessionResult): DevelopmentSessionResult {
  return { ...result, run: compactRun(result.run) };
}

function compactRun(run: WorkflowRunResult): WorkflowRunResult {
  return {
    ...run,
    variables: {},
    checkpoints: [],
    nodeRuns: run.nodeRuns.map((nodeRun) => compactNodeRun(nodeRun)),
  };
}

export function compactNodeRun(nodeRun: WorkflowNodeRun): WorkflowNodeRun {
  return {
    ...nodeRun,
    input: undefined,
    output: compactOutput(nodeRun.output),
  };
}

function compactOutput(output: WorkflowNodeRun['output']): WorkflowNodeRun['output'] {
  if (!output) return output;
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (key === 'rawOutput') continue;
    if (key === 'events' && Array.isArray(value)) {
      compacted.events = value.slice(0, MAX_EVENTS).map(compactEvent);
      continue;
    }
    compacted[key] = compactValue(value);
  }
  return compacted as WorkflowNodeRun['output'];
}

function compactEvent(event: unknown): Record<string, unknown> {
  if (typeof event !== 'object' || event === null) return {};
  const record = event as Record<string, unknown>;
  const compacted: Record<string, unknown> = {};
  if (typeof record.type === 'string') compacted.type = record.type;
  if (typeof record.part === 'object' && record.part !== null) {
    const part = record.part as Record<string, unknown>;
    const compactPart: Record<string, unknown> = {};
    if (typeof part.type === 'string') compactPart.type = part.type;
    if (typeof part.tool === 'string') compactPart.tool = part.tool;
    if (typeof part.text === 'string' && part.text.trim())
      compactPart.text = truncate(part.text, MAX_STEP_TEXT);
    if (Object.keys(compactPart).length > 0) compacted.part = compactPart;
  }
  return compacted;
}

function compactValue(value: unknown): unknown {
  const serialized = safeStringify(value);
  if (serialized === undefined || serialized.length <= MAX_FIELD_BYTES) return value;
  return truncate(serialized, MAX_FIELD_BYTES) + `…（已截断，完整大小 ${serialized.length} 字节）`;
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}
