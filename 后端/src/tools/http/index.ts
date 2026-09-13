import type { JsonObject, JsonValue } from '@ai-workflow/shared-types';
import {
  optionalPositiveInteger,
  optionalString,
  requiredString,
  toolFailure,
  type Tool,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from '../types.js';

const LOCAL_DOMAINS = ['localhost', '127.0.0.1', '::1'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
type HttpMethod = (typeof METHODS)[number];

export class HttpRequestTool implements Tool {
  readonly name = 'http_request';
  readonly description = '向显式 allowlist 中的 HTTP/HTTPS 地址发起请求';
  readonly inputSchema: JsonObject = {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', format: 'uri' },
      method: { type: 'string', enum: [...METHODS] },
      headers: { type: 'object' },
      body: {},
      timeoutMs: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
  };

  constructor(
    private readonly options: {
      allowedDomains?: ReadonlyArray<string>;
      timeoutMs?: number;
      maxResponseBytes?: number;
    } = {},
  ) {}

  async execute(input: JsonObject, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    context.signal?.addEventListener('abort', onAbort, { once: true });
    const timeoutMs =
      optionalPositiveInteger(input, 'timeoutMs') ?? this.options.timeoutMs ?? 10_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const urlText = requiredString(input, 'url');
      const url = new URL(urlText);
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return toolFailure('INVALID_INPUT', 'url 只支持 HTTP/HTTPS');
      if (!this.isAllowed(url.hostname))
        return toolFailure('HTTP_DOMAIN_NOT_ALLOWED', `不允许访问域名：${url.hostname}`);
      const method = (optionalString(input, 'method') ?? 'GET').toUpperCase();
      if (!METHODS.includes(method as HttpMethod))
        return toolFailure('INVALID_INPUT', `不支持的 HTTP method：${method}`);
      const headers = headersOf(input.headers);
      const body = input.body === undefined ? undefined : bodyOf(input.body, headers);
      const response = await fetch(url, { method, headers, body, signal: controller.signal });
      const maxBytes = this.options.maxResponseBytes ?? 512 * 1024;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes)
        return toolFailure('HTTP_RESPONSE_TOO_LARGE', `响应超过大小限制（${maxBytes} bytes）`);
      const text = new TextDecoder().decode(bytes);
      return {
        ok: response.ok,
        output: {
          url: url.toString(),
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: text,
        },
        ...(response.ok
          ? {}
          : { error: { code: 'HTTP_STATUS_ERROR', message: `HTTP ${response.status}` } }),
      };
    } catch (error) {
      if (controller.signal.aborted)
        return toolFailure(
          context.signal?.aborted ? 'CANCELLED' : 'HTTP_TIMEOUT',
          context.signal?.aborted ? 'HTTP 请求已取消' : 'HTTP 请求超时',
        );
      return toolFailure('HTTP_ERROR', error);
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', onAbort);
    }
  }

  private isAllowed(hostname: string): boolean {
    const allowed = this.options.allowedDomains ?? LOCAL_DOMAINS;
    return allowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  }
}

function headersOf(value: JsonValue | undefined): Record<string, string> {
  if (value === undefined) return {};
  if (!isJsonObject(value)) throw new Error('headers 必须是对象');
  const headers: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error(`header ${key} 必须是字符串`);
    headers[key] = item;
  }
  return headers;
}

function bodyOf(value: JsonValue, headers: Record<string, string>): string {
  if (typeof value === 'string') return value;
  if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type'))
    headers['content-type'] = 'application/json';
  return JSON.stringify(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
