import type { JsonObject, JsonValue, LoopNode, WorkflowEdge } from '@ai-workflow/shared-types';

export interface LoopState {
  variables: JsonObject;
  nodeOutputs: Readonly<Record<string, JsonObject>>;
}
export interface LoopEvaluationResult {
  stop: boolean;
  error?: string;
}
export interface ClassifiedLoopEdges {
  body: WorkflowEdge | undefined;
  exit: WorkflowEdge | undefined;
  all: WorkflowEdge[];
}
export class LoopEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoopEvaluationError';
  }
}

export function evaluateLoopStopCondition(
  expression: string,
  state: LoopState,
): LoopEvaluationResult {
  try {
    return { stop: evaluateLoopCondition(expression, state) };
  } catch (error) {
    return { stop: false, error: error instanceof Error ? error.message : String(error) };
  }
}
export function evaluateLoopCondition(expression: string, state: LoopState): boolean {
  const trimmed = expression.trim();
  if (!trimmed) throw new LoopEvaluationError('Loop stopCondition 不能为空');
  return trimmed
    .split('||')
    .some((part) => part.split('&&').every((item) => evaluateComparison(item.trim(), state)));
}
export function classifyLoopEdges(node: LoopNode, edges: WorkflowEdge[]): ClassifiedLoopEdges {
  const bodyId = text(node.config.bodyNodeId);
  const exitId = text(node.config.exitNodeId);
  let body = bodyId
    ? edges.find((edge) => edge.target === bodyId)
    : edges.find((edge) => isBodyLabel(edge.condition));
  let exit = exitId
    ? edges.find((edge) => edge.target === exitId)
    : edges.find((edge) => isExitLabel(edge.condition));

  if (!body) body = edges.find((edge) => edge !== exit) ?? edges[0];
  if (!exit) exit = edges.find((edge) => edge !== body) ?? edges.at(-1);
  if (body && exit && body.id === exit.id) {
    if (bodyId && exitId) exit = undefined;
    else if (bodyId) exit = edges.find((edge) => edge !== body);
    else if (exitId) body = edges.find((edge) => edge !== exit);
    else exit = edges.find((edge) => edge !== body);
  }
  return { body, exit, all: edges };
}
export const selectLoopEdges = classifyLoopEdges;

function evaluateComparison(expression: string, state: LoopState): boolean {
  const match = expression.match(/^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) return Boolean(resolvePath(expression, state));
  const left = resolvePath(match[1]!.trim(), state);
  const right = parseLiteral(match[3]!.trim(), state);
  switch (match[2]) {
    case '===':
      return left === right;
    case '==':
      return looseEquals(left, right);
    case '!==':
      return left !== right;
    case '!=':
      return !looseEquals(left, right);
    case '>':
      return typeof left === 'number' && typeof right === 'number' && left > right;
    case '>=':
      return typeof left === 'number' && typeof right === 'number' && left >= right;
    case '<':
      return typeof left === 'number' && typeof right === 'number' && left < right;
    case '<=':
      return typeof left === 'number' && typeof right === 'number' && left <= right;
    default:
      return false;
  }
}
function parseLiteral(value: string, state: LoopState): JsonValue | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (
    value.length >= 2 &&
    (value[0] === String.fromCharCode(34) || value[0] === String.fromCharCode(39)) &&
    value.at(-1) === value[0]
  )
    return value.slice(1, -1);
  return resolvePath(value, state);
}
function resolvePath(path: string, state: LoopState): JsonValue | undefined {
  const parts = path.replace(/^state\./, '').split('.');
  const root = parts.shift();
  let value: JsonValue | undefined =
    root === 'variables'
      ? state.variables
      : root === 'nodes'
        ? state.nodeOutputs[parts.shift() ?? '']
        : state.variables[root ?? ''];
  for (const part of parts) {
    if (!isObject(value)) return undefined;
    value = value[part];
  }
  return value;
}
function looseEquals(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (typeof left === 'number' && typeof right === 'string') return left === Number(right);
  if (typeof left === 'string' && typeof right === 'number') return Number(left) === right;
  return false;
}
function isBodyLabel(value: string | undefined): boolean {
  return ['continue', 'body', 'retry', 'false'].includes(value?.trim().toLowerCase() ?? '');
}
function isExitLabel(value: string | undefined): boolean {
  return ['stop', 'exit', 'done', 'success', 'true'].includes(value?.trim().toLowerCase() ?? '');
}
function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
