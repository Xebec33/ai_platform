import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const INVITE_CODE_HEADER = 'x-invite-code';
export const INVITE_CODE_QUERY = 'invite_code';

export interface InviteCodeOptions {
  inviteCode?: string;
}

export function readInviteCode(request: FastifyRequest): string | undefined {
  const header = request.headers[INVITE_CODE_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
  const query = (request.query as Record<string, unknown> | undefined)?.[INVITE_CODE_QUERY];
  if (typeof query === 'string' && query.trim()) return query.trim();
  return undefined;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: InviteCodeOptions = {},
): Promise<void> {
  app.post<{ Body: { code?: unknown } }>('/auth/invite', async (request, reply) => {
    if (!options.inviteCode) return reply.send({ ok: true, required: false });
    const bodyCode = request.body?.code;
    const code = typeof bodyCode === 'string' ? bodyCode.trim() : '';
    if (code !== options.inviteCode) {
      return reply.code(401).send({ error: '邀请码无效', code: 'INVALID_INVITE_CODE' });
    }
    return reply.send({ ok: true, required: true });
  });
}

export function createInviteCodeGuard(inviteCode: string | undefined) {
  const publicPaths = new Set(['/health', '/auth/invite']);
  return async function enforceInviteCode(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | void> {
    if (!inviteCode) return;
    const pathname = request.url.split('?')[0] ?? request.url;
    if (publicPaths.has(pathname)) return;
    if (readInviteCode(request) === inviteCode) return;
    return reply.code(401).send({ error: '需要有效邀请码', code: 'INVITE_CODE_REQUIRED' });
  };
}
