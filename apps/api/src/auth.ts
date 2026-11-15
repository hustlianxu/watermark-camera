import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const COOKIE = 'wc_sid_v2';
const MAX_AGE = 30 * 24 * 60 * 60;

export interface SessionUser {
  id: string;
  role: 'admin' | 'user';
}

interface SessionPayload extends SessionUser {
  exp: number;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: SessionPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token: string, secret: string): SessionUser | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.id || payload.exp < Date.now()) return null;
    return { id: payload.id, role: payload.role === 'admin' ? 'admin' : 'user' };
  } catch {
    return null;
  }
}

export function auth(secret: string) {
  return {
    set(reply: FastifyReply, user: SessionUser): void {
      const token = sign({ ...user, exp: Date.now() + MAX_AGE * 1000 }, secret);
      reply.setCookie(COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: MAX_AGE,
      });
    },
    clear(reply: FastifyReply): void {
      reply.clearCookie(COOKIE, { path: '/' });
    },
    current(req: FastifyRequest): SessionUser | null {
      const token = req.cookies?.[COOKIE];
      return token ? verify(token, secret) : null;
    },
    check(req: FastifyRequest): boolean {
      return !!this.current(req);
    },
    require(req: FastifyRequest, reply: FastifyReply): boolean {
      if (this.current(req)) return true;
      reply.code(401).send({ error: 'UNAUTHORIZED', message: '请先登录' });
      return false;
    },
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordOk(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionCookieName(): string {
  return COOKIE;
}
