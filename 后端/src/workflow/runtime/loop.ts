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

export function evaluateConfiguredCondition(
  parameter: string,
  relation: string,
  comparisonValue: JsonValue | undefined,
  state: LoopState,
): boolean {
  const left = resolvePath(parameter, state);
  const right = parseConfiguredLiteral(comparisonValue);
  switch (relation) {
    case 'equals':
      return looseEquals(left, right);
    case 'not_equals':
      return !looseEquals(left, right);
    case 'greater_than':
      return compareNumbers(left, right, (a, b) => a > b);
    case 'greater_or_equal':
      return compareNumbers(left, right, (a, b) => a >= b);
    case 'less_than':
      return compareNumbers(left, right, (a, b) => a < b);
    case 'less_or_equal':
      return compareNumbers(left, right, (a, b) => a <= b);
    default:
      throw new LoopEvaluationError('不支持的 Condition relation：' + relation);
  }
}

function parseConfiguredLiteral(value: JsonValue | undefined): JsonValue | undefined {
  if (typeof value !== 'string') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return value;
}

function compareNumbers(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
  compare: (left: number, right: number) => boolean,
): boolean {
  return typeof left === 'number' && typeof right === 'number' && compare(left, right);
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
  const normalized = path.replace(/^state\./, '').trim();
  if (!normalized) return undefined;
  const parts = normalized.split('.');
  const root = parts[0];
  if (root === 'variables') return readPath(state.variables, parts.slice(1));
  if (root === 'nodes') {
    const nodeId = parts[1];
    return nodeId ? readPath(state.nodeOutputs[nodeId], parts.slice(2)) : undefined;
  }

  const variableValue = readPath(state.variables, parts);
  if (variableValue !== undefined) return variableValue;
  const outputEntries = Object.entries(state.nodeOutputs);
  for (let index = outputEntries.length - 1; index >= 0; index -= 1) {
    const value = readPath(outputEntries[index]?.[1], parts);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readPath(value: JsonValue | undefined, parts: string[]): JsonValue | undefined {
  let current = value;
  for (const part of parts) {
    if (!isObject(current)) return undefined;
    current = current[part];
  }
  return current;
}
function looseEquals(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (typeof left === 'number' && typeof right === 'string') return Number.isFinite(Number(right)) && left === Number(right);
  if (typeof left === 'string' && typeof right === 'number') return Number.isFinite(Number(left)) && Number(left) === right;
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
