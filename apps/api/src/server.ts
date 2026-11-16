import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { constants, generateKeyPairSync, privateDecrypt, randomUUID } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { auth, hashPassword, verifyPassword } from './auth.js';
import { randomBytes } from 'node:crypto';
import { JsonStore, type CaptureSettings, type ExportItem, type ExportTranslationSummary } from './store.js';
import { getBuiltinTemplates, renderClean, renderRecord } from './render.js';
import { createStorage, storageConfigFromEnv } from '@wc/storage';
import {
  normalizeTranslationConfig,
  resolveBilingualFields,
  restoreWhitelist,
  translationStatusText,
  type BilingualResult,
  type TranslateFn,
  type TranslationConfig,
} from './export-i18n.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const dataDir = process.env.DATA_DIR ?? resolve(root, 'data');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const adminPassword = process.env.ADMIN_PASSWORD ?? 'change-me-now';
const sessionSecret = process.env.SESSION_SECRET ?? 'dev-only-change-me';
const secureCookie = process.env.NODE_ENV === 'production';
const llmBase = (process.env.LLM_BASE_URL ?? '').replace(/\/$/, '');
const llmKey = process.env.LLM_API_KEY ?? '';
const llmModel = process.env.LLM_MODEL ?? 'gpt-4o-mini';

const webDist = resolve(root, 'apps/web/dist');
const storageCfg = storageConfigFromEnv({
  ...process.env,
  LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR ?? join(dataDir, 'wc'),
});
const storage = createStorage(storageCfg);
const store = new JsonStore(dataDir);
const exportJobs = new Map<string, ExportItem>();
const a = auth(sessionSecret);
function currentUser(req: any) { return a.current(req)!; }
function scopeOwner(req: any): string | undefined {
  const u = currentUser(req);
  return u.role === 'admin' ? undefined : u.id;
}
function canAccessRecord(req: any, r: { ownerId?: string }): boolean {
  const u = currentUser(req);
  return u.role === 'admin' || !r.ownerId || r.ownerId === u.id;
}
function canAccessFolder(req: any, id: string): boolean {
  const f = store.getFolder(id);
  if (!f) return false;
  const u = currentUser(req);
  return u.role === 'admin' || !f.ownerId || f.ownerId === u.id;
}
function imageVersion(r: any): number { return Number(r.updatedAt || r.createdAt || 0); }
function imageUrlFor(r: any): string { return `/api/files/render/${r.id}?v=${imageVersion(r)}`; }
function thumbUrlFor(r: any): string { return `/api/files/thumb/${r.id}?v=${imageVersion(r)}`; }

function visibleRecord(req: any, id: string) {
  const r = store.getRecord(id);
  return r && canAccessRecord(req, r) ? r : undefined;
}
const loginAttempts = new Map<string, { count: number; until: number }>();

const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024, trustProxy: true });

await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024, files: 1 } });

const FREE_DAILY_CHARS = 5000;
const freeUsage = new Map<string, { date: string; chars: number }>();
function freeCharsUsed(ownerId: string): number {
  const today = new Date().toISOString().slice(0, 10);
  const state = freeUsage.get(ownerId);
  return state?.date === today ? state.chars : 0;
}
function addFreeChars(ownerId: string, chars: number): void {
  const today = new Date().toISOString().slice(0, 10);
  const used = freeCharsUsed(ownerId);
  freeUsage.set(ownerId, { date: today, chars: used + chars });
}

async function callMyMemory(text: string, from: 'zh' | 'es', to: 'zh' | 'es'): Promise<string> {
  const langpair = from === 'es' ? 'es|zh' : 'zh|es';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`FREE_HTTP_${res.status}`);
  const data = await res.json() as any;
  const out = data?.responseData?.translatedText;
  if (!out) throw new Error('FREE_EMPTY');
  return String(out).trim();
}

async function callLlm(ownerId: string, text: string, from: 'zh' | 'es', to: 'zh' | 'es'): Promise<string> {
  const settings = store.getUserSettings(ownerId).llm;
  const base = settings?.baseURL || llmBase;
  const key = settings?.apiKey || llmKey;
  const model = settings?.model || llmModel;
  if (!base || !key) throw new Error('LLM_NOT_CONFIGURED');
  const fromLabel = from === 'es' ? 'Spanish' : 'Chinese';
  const toLabel = to === 'zh' ? 'Chinese' : 'Spanish';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `You are a foreign-trade product translator. Translate from ${fromLabel} to ${toLabel}. Keep product codes, numbers, units and line breaks unchanged. Text in the form [[0]], [[1]] is protected; reproduce every placeholder exactly and do not translate it. Return only the translation, no explanation.`,
        },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM_HTTP_${res.status}`);
  const data = await res.json() as any;
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error('LLM_EMPTY');
  return String(out).trim();
}

function translationConfigFor(ownerId: string): TranslationConfig {
  return normalizeTranslationConfig(store.getUserSettings(ownerId).translation);
}

const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = { saveLocal: true, syncRemote: true, excelExportRequired: false };

function captureSettingsFor(ownerId: string): CaptureSettings {
  const saved = store.getUserSettings(ownerId).capture;
  const hasXlsxExport = store.listExports(ownerId).some((e) => e.type === 'xlsx');
  const excelExportRequired = !!saved?.excelExportRequired || hasXlsxExport;
  return {
    saveLocal: saved?.saveLocal !== false,
    // Excel reads remote records; once used, remote sync is a hard requirement.
    syncRemote: excelExportRequired ? true : saved?.syncRemote !== false,
    excelExportRequired,
  };
}

async function markExcelExportRequired(ownerId: string): Promise<void> {
  const current = captureSettingsFor(ownerId);
  if (current.excelExportRequired) return;
  await store.updateUserSettings(ownerId, {
    capture: { ...current, excelExportRequired: true },
  });
}

function makeExportTranslator(ownerId: string, config: TranslationConfig): TranslateFn {
  const order = config.priority === 'free-local-llm'
    ? ['free', 'local', 'llm']
    : config.priority === 'llm-local-free'
      ? ['llm', 'local', 'free']
      : ['local', 'free', 'llm'];
  return async ({ text, maskedText, masks, from, to }) => {
    for (const engine of order) {
      if (engine === 'local') {
        for (const pair of config.dictPairs) {
          const out = from === 'zh' && pair.zh === text
            ? pair.es
            : from === 'es' && pair.es === text
              ? pair.zh
              : null;
          if (out && restoreWhitelist(out, { masked: maskedText, masks }) !== null) return out;
        }
        continue;
      }
      if (engine === 'free') {
        if (!config.freeEnabled || maskedText.length > 500) continue;
        if (freeCharsUsed(ownerId) + maskedText.length > FREE_DAILY_CHARS) continue;
        try {
          const out = await callMyMemory(maskedText, from, to);
          if (!out || restoreWhitelist(out, { masked: maskedText, masks }) === null) continue;
          addFreeChars(ownerId, maskedText.length);
          return out;
        } catch (e: any) {
          app.log.warn({ err: e?.message, ownerId }, 'free translation failed during export');
        }
        continue;
      }
      if (maskedText.length > 2000) continue;
      try {
        const out = await callLlm(ownerId, maskedText, from, to);
        if (!out || restoreWhitelist(out, { masked: maskedText, masks }) === null) continue;
        return out;
      } catch (e: any) {
        app.log.warn({ err: e?.message, ownerId }, 'LLM translation failed during export');
      }
    }
    return null;
  };
}

interface ExportContext {
  ownerId: string;
  config: TranslationConfig;
  translate: TranslateFn;
}

function exportContextFor(ownerId: string): ExportContext {
  const config = translationConfigFor(ownerId);
  return { ownerId, config, translate: makeExportTranslator(ownerId, config) };
}

function emptySummary(): ExportTranslationSummary {
  return { translated: 0, originalPair: 0, unknown: 0, failed: 0, empty: 0 };
}
function addSummary(summary: ExportTranslationSummary, result: BilingualResult): void {
  if (result.status === 'original_pair') summary.originalPair += 1;
  else summary[result.status] += 1;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!, index);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

const loginKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const loginPublicJwk = loginKeys.publicKey.export({ format: 'jwk' });

app.get('/healthz', async () => ({ ok: true, service: 'watermark-camera' }));

app.get('/api/auth/public-key', async (_req, reply) => {
  reply.header('Cache-Control', 'no-store');
  return { key: loginPublicJwk, alg: 'RSA-OAEP-256' };
});

app.post('/api/login', async (req, reply) => {
  const ip = req.ip;
  const now = Date.now();
  const state = loginAttempts.get(ip);
  if (state && state.until > now) {
    return reply.code(429).send({ error: 'RATE_LIMITED', message: '尝试过多，请 15 分钟后再试' });
  }
  const body = req.body as { username?: string; password?: string; passwordEnc?: string } | undefined;
  const username = (body?.username || 'admin').trim();
  const user = store.getUserByUsername(username);
  let password = body?.password ?? '';
  if (body?.passwordEnc) {
    try {
      password = privateDecrypt({ key: loginKeys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(body.passwordEnc, 'base64')).toString('utf8');
    } catch {
      return reply.code(400).send({ error: 'BAD_ENCRYPTED_PASSWORD', message: '登录数据解析失败，请刷新页面重试' });
    }
  }
  if (!password || !user || !verifyPassword(password, user.passwordHash)) {
    const next = { count: (state?.count ?? 0) + 1, until: 0 };
    if (next.count >= 5) next.until = now + 15 * 60_000;
    loginAttempts.set(ip, next);
    return reply.code(401).send({ error: 'BAD_PASSWORD', message: '密码错误' });
  }
  loginAttempts.delete(ip);
  a.set(reply, { id: user.id, role: user.role });
  return { ok: true, user: user.username, role: user.role };
});

app.post('/api/logout', async (_req, reply) => {
  a.clear(reply);
  return { ok: true };
});

app.get('/api/me', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const u = a.current(req)!;
  const user = store.getUser(u.id);
  return { ok: true, id: u.id, user: user?.username ?? u.id, role: u.role };
});

app.get('/api/translation-settings', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const ownerId = currentUser(req).id;
  return { ...translationConfigFor(ownerId), configured: !!store.getUserSettings(ownerId).translation };
});

app.put('/api/translation-settings', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const config = normalizeTranslationConfig(req.body);
  await store.updateUserSettings(currentUser(req).id, { translation: config });
  return { ...config, configured: true };
});

app.get('/api/capture-settings', async (req, reply) => {
  if (!a.require(req, reply)) return;
  return captureSettingsFor(currentUser(req).id);
});

app.put('/api/capture-settings', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const ownerId = currentUser(req).id;
  const current = captureSettingsFor(ownerId);
  const body = req.body as Partial<CaptureSettings> | undefined;
  const next: CaptureSettings = {
    saveLocal: typeof body?.saveLocal === 'boolean' ? body.saveLocal : current.saveLocal,
    syncRemote: typeof body?.syncRemote === 'boolean' ? body.syncRemote : current.syncRemote,
    excelExportRequired: current.excelExportRequired,
  };
  if (!next.saveLocal && !next.syncRemote) {
    return reply.code(409).send({ error: 'AT_LEAST_ONE_DESTINATION', message: '“保存本地”和“同步远程”至少保留一个' });
  }
  if (current.excelExportRequired && !next.syncRemote) {
    return reply.code(409).send({
      error: 'REMOTE_SYNC_REQUIRED',
      message: '该账号已使用 Excel 导出，Excel 依赖远程数据，不能关闭“同步远程”',
    });
  }
  await store.updateUserSettings(ownerId, { capture: next });
  return next;
});

app.post('/api/free-translate', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const body = req.body as { text?: string; from?: string; to?: string } | undefined;
  const text = (body?.text ?? '').trim();
  if (!text) return reply.code(400).send({ error: 'EMPTY_TEXT' });
  if (text.length > 500) return reply.code(413).send({ error: 'TOO_LONG' });
  const from = body?.from === 'es' ? 'es' : 'zh';
  const to = from === 'es' ? 'zh' : 'es';
  try {
    const out = await callMyMemory(text, from, to);
    return { text: out, source: 'mymemory' };
  } catch (e: any) {
    return reply.code(502).send({ error: 'FREE_FAILED', message: e?.message ?? 'free translate failed' });
  }
});

app.post('/api/translate', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const ownerId = currentUser(req).id;
  const llm = store.getUserSettings(ownerId).llm;
  if (!(llm?.baseURL || llmBase) || !(llm?.apiKey || llmKey)) {
    return reply.code(501).send({ error: 'LLM_NOT_CONFIGURED', message: '未配置大模型，请在设置中填写 API Key' });
  }
  const body = req.body as { text?: string; from?: string; to?: string } | undefined;
  const text = (body?.text ?? '').trim();
  if (!text) return reply.code(400).send({ error: 'EMPTY_TEXT' });
  if (text.length > 2000) return reply.code(413).send({ error: 'TOO_LONG' });
  const from = body?.from === 'es' ? 'es' : 'zh';
  const to = from === 'es' ? 'zh' : 'es';
  try {
    const out = await callLlm(ownerId, text, from, to);
    if (!out) return reply.code(502).send({ error: 'LLM_EMPTY' });
    return { text: out };
  } catch (e: any) {
    return reply.code(502).send({ error: 'LLM_FAILED', message: e?.message ?? 'LLM request failed' });
  }
});

app.get('/api/users', async (req, reply) => {
  if (!a.require(req, reply)) return;
  if (currentUser(req).role !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN' });
  return { users: store.listUsers().map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt })) };
});

app.post('/api/users', async (req, reply) => {
  if (!a.require(req, reply)) return;
  if (currentUser(req).role !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN' });
  const body = req.body as { username?: string; password?: string; role?: string } | undefined;
  const username = (body?.username ?? '').trim().toLowerCase();
  const password = body?.password ?? '';
  if (!/^[a-z0-9_.-]{2,30}$/.test(username)) return reply.code(400).send({ error: 'INVALID_USERNAME', message: '用户名 2-30 位，字母数字._-' });
  if (password.length < 6) return reply.code(400).send({ error: 'WEAK_PASSWORD', message: '密码至少 6 位' });
  if (store.getUserByUsername(username)) return reply.code(409).send({ error: 'USER_EXISTS', message: '用户名已存在' });
  const user = { id: randomUUID(), username, passwordHash: hashPassword(password), role: (body?.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user', createdAt: Date.now() };
  await store.addUser(user);
  return reply.code(201).send({ id: user.id, username: user.username, role: user.role });
});

app.post('/api/me/password', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const body = req.body as { oldPassword?: string; newPassword?: string } | undefined;
  const user = store.getUser(currentUser(req).id);
  if (!user || !body?.oldPassword || !verifyPassword(body.oldPassword, user.passwordHash)) return reply.code(400).send({ error: 'BAD_PASSWORD', message: '旧密码错误' });
  if (!body.newPassword || body.newPassword.length < 6) return reply.code(400).send({ error: 'WEAK_PASSWORD', message: '新密码至少 6 位' });
  user.passwordHash = hashPassword(body.newPassword);
  await store.updateUser(user);
  return { ok: true };
});

app.post('/api/users/:id/password', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const targetId = (req.params as { id: string }).id;
  const me = currentUser(req);
  if (me.role !== 'admin' && me.id !== targetId) return reply.code(403).send({ error: 'FORBIDDEN' });
  const user = store.getUser(targetId);
  if (!user) return reply.code(404).send({ error: 'NOT_FOUND' });
  const body = req.body as { password?: string } | undefined;
  if (!body?.password || body.password.length < 6) return reply.code(400).send({ error: 'WEAK_PASSWORD', message: '密码至少 6 位' });
  user.passwordHash = hashPassword(body.password);
  await store.updateUser(user);
  return { ok: true };
});

app.delete('/api/users/:id', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const me = currentUser(req);
  if (me.role !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN' });
  const id = (req.params as { id: string }).id;
  if (id === me.id) return reply.code(400).send({ error: 'CANNOT_DELETE_SELF' });
  return (await store.deleteUser(id)) ? { ok: true } : reply.code(404).send({ error: 'NOT_FOUND' });
});

app.get('/api/templates', async (req, reply) => {
  if (!a.require(req, reply)) return;
  return { templates: getBuiltinTemplates() };
});

app.get('/api/folders', async (req, reply) => {
  if (!a.require(req, reply)) return;
  return { folders: store.listFolders(scopeOwner(req)) };
});

app.post('/api/folders', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const body = req.body as { name?: string } | undefined;
  const name = (body?.name ?? '').trim().slice(0, 40);
  if (!name) return reply.code(400).send({ error: 'INVALID_NAME' });
  try {
    const folder = await store.addFolder(name, currentUser(req).id);
    return reply.code(201).send(folder);
  } catch {
    return reply.code(409).send({ error: 'DUPLICATE_FOLDER', message: '文件夹已存在' });
  }
});

app.delete('/api/folders/:id', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const folder = store.getFolder(id);
  if (!folder) return reply.code(404).send({ error: 'NOT_FOUND' });
  if (currentUser(req).role !== 'admin' && folder.ownerId !== currentUser(req).id) return reply.code(404).send({ error: 'NOT_FOUND' });
  const ok = await store.deleteFolder(id);
  return ok ? { ok: true } : reply.code(404).send({ error: 'NOT_FOUND' });
});

app.get('/api/records', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const q = req.query as { folderId?: string; q?: string; page?: string; pageSize?: string };
  const needle = (q.q ?? '').trim().toLowerCase();
  const records = store.listRecords(scopeOwner(req)).filter((r) => {
    if (q.folderId === 'none' && r.folderId) return false;
    if (q.folderId && q.folderId !== 'none' && r.folderId !== q.folderId) return false;
    if (!needle) return true;
    return Object.values(r.values).join(' ').toLowerCase().includes(needle);
  });
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 24));
  const page = Math.max(1, Number(q.page) || 1);
  const total = records.length;
  const pageRecords = records.slice((page - 1) * pageSize, page * pageSize);
  return {
    total,
    page,
    pageSize,
    records: pageRecords.map((r) => ({
      id: r.id,
      folderId: r.folderId,
      templateId: r.templateId,
      templateName: r.templateName,
      values: r.values,
      width: r.width,
      height: r.height,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      imageUrl: imageUrlFor(r),
    })),
  };
});

app.get('/api/records/:id', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const r = visibleRecord(req, id);
  if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
  return {
    ...r,
    template: getBuiltinTemplates().find((t) => t.id === r.templateId),
    imageUrl: imageUrlFor(r),
    originalUrl: `/api/files/orig/${r.id}?v=${imageVersion(r)}`,
  };
});

app.patch('/api/records/:id', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const r = visibleRecord(req, id);
  if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
  const body = req.body as { values?: Record<string, string>; spec?: Record<string, unknown>; folderId?: string | null } | undefined;
  const values = { ...r.values, ...(body?.values ?? {}) };
  const spec = { ...(r.spec as Record<string, unknown>), ...(body?.spec ?? {}) };
  const folderId = body?.folderId === null ? undefined : (body?.folderId ?? r.folderId);
  if (folderId && !canAccessFolder(req, folderId)) return reply.code(404).send({ error: 'FOLDER_NOT_FOUND' });
  const visualChange = body?.values !== undefined || body?.spec !== undefined;
  let rendered: { width: number; height: number; buffer?: Buffer } = { width: r.width, height: r.height };
  if (visualChange) {
    const original = await buffer(await storage.getObject(r.originalKey));
    rendered = await renderRecord({ original, templateId: r.templateId, values, spec });
    await storage.putObject(r.renderKey, rendered.buffer!, { contentType: 'image/jpeg' });
  }
  const updated = { ...r, folderId, values, spec, width: rendered.width, height: rendered.height, watermarkRemoved: visualChange ? false : r.watermarkRemoved, updatedAt: visualChange ? Date.now() : (r.updatedAt || r.createdAt) };
  await store.updateRecord(updated);
  await invalidateThumb(id);
  return { ...updated, imageUrl: imageUrlFor(updated) };
});

app.post('/api/records', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: 'NO_FILE' });
  const fields = file.fields as Record<string, any>;
  const templateId = String(fields.templateId?.value ?? 'minimal');
  const folderId = fields.folderId?.value ? String(fields.folderId.value) : undefined;
  if (folderId && !canAccessFolder(req, folderId)) return reply.code(404).send({ error: 'FOLDER_NOT_FOUND' });
  const values = JSON.parse(String(fields.values?.value ?? '{}')) as Record<string, string>;
  const spec = JSON.parse(String(fields.spec?.value ?? '{}')) as Record<string, unknown>;
  const original = await file.toBuffer();
  if (original.length > 30 * 1024 * 1024) return reply.code(413).send({ error: 'TOO_LARGE' });
  const id = randomUUID();
  const template = getBuiltinTemplates().find((t) => t.id === templateId);
  if (!template) return reply.code(400).send({ error: 'TEMPLATE_NOT_FOUND' });
  const rendered = await renderRecord({ original, templateId, values, spec });
  const originalKey = `orig/${id}.jpg`;
  const renderKey = `render/${id}.jpg`;
  await storage.putObject(originalKey, original, { contentType: 'image/jpeg' });
  await storage.putObject(renderKey, rendered.buffer, { contentType: 'image/jpeg' });
  const record = {
    id,
    folderId,
    ownerId: currentUser(req).id,
    templateId,
    templateName: template.name,
    values,
    spec,
    width: rendered.width,
    height: rendered.height,
    mime: 'image/jpeg',
    originalKey,
    renderKey,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await store.addRecord(record);
  return reply.code(201).send({ ...record, imageUrl: imageUrlFor(record) });
});

app.post('/api/records/:id/remove-watermark', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const r = visibleRecord(req, id);
  if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
  const original = await buffer(await storage.getObject(r.originalKey));
  const clean = await renderClean(original);
  await storage.putObject(r.renderKey, clean.buffer, { contentType: 'image/jpeg' });
  const updated = { ...r, width: clean.width, height: clean.height, watermarkRemoved: true, updatedAt: Date.now() };
  await store.updateRecord(updated);
  await invalidateThumb(id);
  return { ...updated, imageUrl: imageUrlFor(updated) };
});

app.post('/api/records/:id/copy', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const r = visibleRecord(req, id);
  if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
  const body = req.body as { folderId?: string } | undefined;
  if (body?.folderId && !canAccessFolder(req, body.folderId)) return reply.code(404).send({ error: 'FOLDER_NOT_FOUND' });
  const newId = randomUUID();
  const origExt = r.originalKey.split('.').pop() || 'jpg';
  const originalKey = `orig/${newId}.${origExt}`;
  const renderKey = `render/${newId}.jpg`;
  const original = await buffer(await storage.getObject(r.originalKey));
  const rendered = await buffer(await storage.getObject(r.renderKey));
  await storage.putObject(originalKey, original, { contentType: r.mime || 'image/jpeg' });
  await storage.putObject(renderKey, rendered, { contentType: 'image/jpeg' });
  const copy = {
    ...r, id: newId, originalKey, renderKey, ownerId: currentUser(req).id, folderId: body?.folderId || undefined,
    createdAt: Date.now(), updatedAt: Date.now(), capturedAt: r.capturedAt,
  };
  await store.addRecord(copy);
  return reply.code(201).send({ ...copy, imageUrl: imageUrlFor(copy) });
});

app.delete('/api/records/:id', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const r = visibleRecord(req, id);
  if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
  await storage.deleteObject(r.originalKey).catch(() => {});
  await storage.deleteObject(r.renderKey).catch(() => {});
  await store.deleteRecord(id);
  return { ok: true };
});

async function invalidateThumb(id: string): Promise<void> {
  await storage.deleteObject(`thumb/${id}.jpg`).catch(() => {});
}

async function cleanupMissingRecords(): Promise<{ removed: string[] }> {
  const removed: string[] = [];
  for (const r of store.listRecords()) {
    let ok = true;
    try { await storage.headObject(r.originalKey); } catch { ok = false; }
    if (ok) { try { await storage.headObject(r.renderKey); } catch { ok = false; } }
    if (ok) continue;
    await storage.deleteObject(r.originalKey).catch(() => {});
    await storage.deleteObject(r.renderKey).catch(() => {});
    await invalidateThumb(r.id);
    await store.deleteRecord(r.id);
    removed.push(r.id);
  }
  return { removed };
}

async function cleanupExports(): Promise<void> {
  const now = Date.now();
  for (const e of store.listExports()) {
    if (e.expiresAt > now) continue;
    if (e.key) await storage.deleteObject(e.key).catch(() => {});
    await store.deleteExport(e.id);
    exportJobs.delete(e.id);
  }
}

interface XlsxResult {
  buffer: Buffer;
  summary: ExportTranslationSummary;
}

async function makeXlsx(records: any[], contextForRecord: (record: any) => ExportContext): Promise<XlsxResult> {
  const summary = emptySummary();
  const contexts = new Map<string, ExportContext>();
  const caches = new Map<string, Map<string, string | null>>();
  function contextOf(record: any): ExportContext {
    const context = contextForRecord(record);
    const cached = contexts.get(context.ownerId);
    if (cached) return cached;
    contexts.set(context.ownerId, context);
    return context;
  }
  const descriptions = await mapLimit(records, 3, async (r): Promise<BilingualResult> => {
    try {
      const context = contextOf(r);
      let cache = caches.get(context.ownerId);
      if (!cache) {
        cache = new Map<string, string | null>();
        caches.set(context.ownerId, cache);
      }
      return await resolveBilingualFields(r.values, {
        whitelist: context.config.whitelist,
        translate: context.translate,
        cache,
      });
    } catch (e: any) {
      app.log.warn({ err: e?.message, recordId: r.id }, 'description normalisation failed');
      const es = String(r.values?.desEs ?? '').trim();
      const zh = String(r.values?.desZh ?? '').trim();
      return { c: es, d: zh, sourceLang: 'unknown', status: 'failed', cjk: 0, latin: 0 };
    }
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = '外贸水印相机';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Fotos', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'FOTO', key: 'foto', width: 34 },
    { header: 'CODIGO', key: 'codigo', width: 20 },
    { header: 'DETALLADOS', key: 'detallados', width: 48 },
    { header: '描述', key: 'desZh', width: 48 },
    { header: 'PRECIO', key: 'precio', width: 14 },
    { header: 'CANTIDAD DE CAJA', key: 'pzs', width: 18 },
    { header: 'CUANTAS CAJAS', key: 'cajas', width: 16 },
    { header: 'CUBICO', key: 'volumen', width: 14 },
    { header: 'PESO', key: 'peso', width: 14 },
    { header: '翻译状态', key: 'translationStatus', width: 14, hidden: true },
  ];
  const header = sheet.getRow(1);
  header.height = 28;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.eachCell((c) => { c.border = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } }; });
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const description: BilingualResult = descriptions[i]
      ?? { c: '', d: '', sourceLang: 'unknown', status: 'empty', cjk: 0, latin: 0 };
    addSummary(summary, description);
    const row = sheet.addRow({
      codigo: r.values.modelo ?? '',
      detallados: description.c,
      desZh: description.d,
      precio: r.values.precio ?? '', pzs: r.values.pzs ?? '', cajas: r.values.cajas ?? '',
      volumen: r.values.volumen ?? '', peso: r.values.peso ?? '',
      translationStatus: translationStatusText(description.status),
    });
    row.height = 190;
    row.alignment = { vertical: 'middle', wrapText: true };
    for (let i = 1; i <= 10; i++) row.getCell(i).border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
    const img = await buffer(await storage.getObject(r.renderKey));
    const photo = await loadImage(img);
    const scale = Math.min(1, 1800 / Math.max(photo.width, photo.height));
    let excelImg: any = Buffer.from(img);
    if (scale < 1) {
      const c = createCanvas(Math.round(photo.width * scale), Math.round(photo.height * scale));
      c.getContext('2d').drawImage(photo, 0, 0, c.width, c.height);
      excelImg = await c.encode('jpeg', 92);
    }
    const ratio = photo.width / photo.height;
    let drawW = 280;
    let drawH = drawW / ratio;
    if (drawH > 190) { drawH = 190; drawW = drawH * ratio; }
    const imageId = workbook.addImage({ buffer: excelImg as any, extension: 'jpeg' });
    sheet.addImage(imageId, { tl: { col: 0.1, row: row.number - 1 + 0.04 }, ext: { width: Math.round(drawW), height: Math.round(drawH) }, editAs: 'oneCell' });
  }
  const data = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(data), summary };
}

async function makeZip(records: any[]): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 6 } });
  return new Promise(async (resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.on('data', (c) => chunks.push(Buffer.from(c)));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    try {
      for (const r of records) {
        const name = `${String(r.values.modelo || r.id).replace(/[^a-zA-Z0-9._-]+/g, '_')}.jpg`;
        archive.append(await storage.getObject(r.renderKey), { name });
      }
      await archive.finalize();
    } catch (e) { reject(e); }
  });
}

async function runExportJob(id: string) {
  const job = exportJobs.get(id);
  if (!job) return;
  try {
    job.status = 'running';
    const allowed = job.ids ? new Set(job.ids) : null;
    const records = store.listRecords().filter((r) => !allowed || allowed.has(r.id));
    let data: Buffer;
    if (job.type === 'zip') {
      data = await makeZip(records);
    } else {
      const ownerId = job.ownerId ?? store.getUserByUsername('admin')?.id ?? '';
      const built = await makeXlsx(records, (r) => exportContextFor(r.ownerId ?? ownerId));
      data = built.buffer;
      job.translation = built.summary;
    }
    const key = `export/${id}.${job.type === 'zip' ? 'zip' : 'xlsx'}`;
    await storage.putObject(key, data, { contentType: job.type === 'zip' ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    job.key = key;
    job.status = 'ready';
    job.size = data.length;
    await store.updateExport(job);
  } catch (e: any) {
    job.status = 'failed';
    job.error = e?.message ?? 'export failed';
    await store.updateExport(job);
  }
}

async function sendObject(reply: any, key: string, cache = 'private, max-age=300') {
  const head = await storage.headObject(key);
  reply.header('Content-Type', head.contentType ?? 'image/jpeg');
  reply.header('Cache-Control', cache);
  return reply.send(await storage.getObject(key));
}

app.get('/api/files/thumb/:id', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const r = visibleRecord(req, id);
  if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
  const version = String((req.query as any)?.v || '').replace(/[^0-9]/g, '').slice(0, 20);
  const key = version ? `thumb/${id}-${version}.jpg` : `thumb/${id}.jpg`;
  try {
    await storage.headObject(key);
    return sendObject(reply, key, 'private, max-age=86400');
  } catch {}
  const full = await buffer(await storage.getObject(r.renderKey));
  const img = await loadImage(full);
  const scale = Math.min(1, 360 / Math.max(img.width, img.height));
  const c = createCanvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const thumb = await c.encode('jpeg', 82);
  await storage.putObject(key, thumb, { contentType: 'image/jpeg' });
  return sendObject(reply, key, 'private, max-age=86400');
});

app.get('/api/files/render/:id', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const r = visibleRecord(req, id);
  if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
  return sendObject(reply, r.renderKey);
});

app.get('/api/files/orig/:id', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const r = visibleRecord(req, id);
  if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
  return sendObject(reply, r.originalKey);
});

app.post('/api/maintenance/cleanup-missing', async (req, reply) => {
  if (!a.require(req, reply)) return;
  if (currentUser(req).role !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN' });
  return cleanupMissingRecords();
});

app.get('/api/settings', async (req, reply) => {
  if (!a.require(req, reply)) return;
  return store.getSettings();
});

app.put('/api/settings', async (req, reply) => {
  if (!a.require(req, reply)) return;
  if (currentUser(req).role !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN' });
  const body = req.body as { exportTtlDays?: number } | undefined;
  const ttl = Math.min(90, Math.max(1, Number(body?.exportTtlDays ?? 7)));
  return store.updateSettings({ exportTtlDays: ttl });
});

app.get('/api/llm', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const l = store.getUserSettings(currentUser(req).id).llm;
  return { provider: l?.provider ?? '', baseURL: l?.baseURL ?? '', model: l?.model ?? '', hasKey: !!l?.apiKey };
});

app.put('/api/llm', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const body = req.body as { provider?: string; baseURL?: string; model?: string; apiKey?: string } | undefined;
  const prev = store.getUserSettings(currentUser(req).id).llm;
  const next = {
    provider: (body?.provider ?? prev?.provider ?? 'custom').slice(0, 40),
    baseURL: (body?.baseURL ?? prev?.baseURL ?? '').replace(/\/$/, '').slice(0, 300),
    model: (body?.model ?? prev?.model ?? '').slice(0, 100),
    apiKey: body?.apiKey ? body.apiKey.slice(0, 500) : (prev?.apiKey ?? ''),
  };
  await store.updateUserSettings(currentUser(req).id, { llm: next });
  return { ok: true, provider: next.provider, model: next.model, hasKey: !!next.apiKey };
});

app.post('/api/llm/models', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const body = req.body as { baseURL?: string; apiKey?: string } | undefined;
  const saved = store.getUserSettings(currentUser(req).id).llm;
  const base = (body?.baseURL || saved?.baseURL || llmBase || '').replace(/\/$/, '');
  const key = body?.apiKey || saved?.apiKey || llmKey;
  if (!base || !key) return reply.code(400).send({ error: 'LLM_NOT_CONFIGURED', message: '请先填写 Base URL 和 API Key' });
  try {
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return reply.code(502).send({ error: 'MODELS_FAILED', message: `HTTP ${res.status}` });
    const data = await res.json() as any;
    const models = (Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [])
      .map((m: any) => typeof m === 'string' ? m : m?.id || m?.name)
      .filter(Boolean);
    return { models: [...new Set(models)].sort() };
  } catch (e: any) {
    return reply.code(502).send({ error: 'MODELS_FAILED', message: e?.message ?? 'fetch models failed' });
  }
});

app.post('/api/exports', async (req, reply) => {
  if (!a.require(req, reply)) return;
  await cleanupExports();
  const body = req.body as { type?: string; ids?: string[] } | undefined;
  const type = body?.type === 'zip' ? 'zip' : 'xlsx';
  const allowed = body?.ids?.length ? new Set(body.ids) : null;
  const records = store.listRecords(scopeOwner(req)).filter((r) => !allowed || allowed.has(r.id));
  if (!records.length) return reply.code(404).send({ error: 'NOT_FOUND' });
  if (records.length > 300) return reply.code(413).send({ error: 'TOO_MANY', message: '单次最多 300 条' });
  const ownerId = currentUser(req).id;
  if (type === 'xlsx' && !captureSettingsFor(ownerId).syncRemote) {
    return reply.code(409).send({
      error: 'REMOTE_SYNC_REQUIRED',
      message: 'Excel 导出依赖远程数据，请先在“设置 → 拍照保存”开启“同步远程”',
    });
  }
  if (type === 'xlsx') await markExcelExportRequired(ownerId);
  const id = randomUUID();
  const ttlDays = store.getSettings().exportTtlDays;
  const item: ExportItem = {
    id, type, status: 'queued', ids: records.map((r) => r.id), ownerId,
    count: records.length, createdAt: Date.now(), expiresAt: Date.now() + ttlDays * 86400000,
  };
  await store.addExport(item);
  exportJobs.set(id, item);
  void runExportJob(id);
  return reply.code(202).send({ id, type, status: 'queued', count: records.length, expiresAt: item.expiresAt });
});

app.get('/api/exports', async (req, reply) => {
  if (!a.require(req, reply)) return;
  await cleanupExports();
  return { exports: store.listExports(scopeOwner(req)) };
});

app.get('/api/exports/:id', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const job = exportJobs.get(id) ?? store.getExport(id);
  if (!job || (currentUser(req).role !== 'admin' && job.ownerId !== currentUser(req).id)) return reply.code(404).send({ error: 'NOT_FOUND' });
  return job;
});

app.get('/api/exports/:id/file', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const job = exportJobs.get(id) ?? store.getExport(id);
  if (!job || (currentUser(req).role !== 'admin' && job.ownerId !== currentUser(req).id) || job.status !== 'ready' || !job.key) return reply.code(404).send({ error: 'NOT_READY' });
  return sendObject(reply, job.key, 'private, max-age=600');
});

app.delete('/api/exports/:id', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { id } = req.params as { id: string };
  const job = exportJobs.get(id) ?? store.getExport(id);
  if (!job || (currentUser(req).role !== 'admin' && job.ownerId !== currentUser(req).id)) return reply.code(404).send({ error: 'NOT_FOUND' });
  if (job.key) await storage.deleteObject(job.key).catch(() => {});
  exportJobs.delete(id);
  await store.deleteExport(id);
  return { ok: true };
});

app.get('/api/export.xlsx', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const q = req.query as { ids?: string };
  const wanted = q.ids ? new Set(q.ids.split(',').filter(Boolean)) : null;
  const records = store.listRecords(scopeOwner(req)).filter((r) => !wanted || wanted.has(r.id));
  if (records.length === 0) return reply.code(404).send({ error: 'NOT_FOUND' });
  if (records.length > 300) return reply.code(413).send({ error: 'TOO_MANY', message: '单次最多导出 300 条' });
  const me = currentUser(req).id;
  if (!captureSettingsFor(me).syncRemote) {
    return reply.code(409).send({
      error: 'REMOTE_SYNC_REQUIRED',
      message: 'Excel 导出依赖远程数据，请先在“设置 → 拍照保存”开启“同步远程”',
    });
  }
  await markExcelExportRequired(me);
  const built = await makeXlsx(records, (r) => exportContextFor(r.ownerId ?? me));
  reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  reply.header('Content-Disposition', `attachment; filename="watermark-${Date.now()}.xlsx"`);
  return reply.send(built.buffer);
});

app.get('/api/export.zip', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const q = req.query as { ids?: string };
  const wanted = q.ids ? new Set(q.ids.split(',').filter(Boolean)) : null;
  const records = store.listRecords(scopeOwner(req)).filter((r) => !wanted || wanted.has(r.id));
  if (records.length === 0) return reply.code(404).send({ error: 'NOT_FOUND' });
  reply.header('Content-Type', 'application/zip');
  reply.header('Content-Disposition', `attachment; filename="watermark-photos-${Date.now()}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', (err) => app.log.warn({ err }, 'zip warning'));
  archive.on('error', (err) => app.log.error({ err }, 'zip error'));
  for (const r of records) {
    const name = `${String(r.values.modelo || r.id).replace(/[^a-zA-Z0-9._-]+/g, '_')}.jpg`;
    archive.append(await storage.getObject(r.renderKey), { name });
  }
  await archive.finalize();
  return reply.send(archive);
});

app.get('/api/shares', async (req, reply) => {
  if (!a.require(req, reply)) return;
  return {
    shares: store.listShares(scopeOwner(req)).map((s) => ({
      token: s.token,
      url: `/s/${s.token}`,
      count: s.recordIds.length,
      folderId: s.folderId,
      folderName: s.folderName,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    })),
  };
});

app.delete('/api/shares/:token', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const { token } = req.params as { token: string };
  const share = store.getShare(token);
  if (!share || (currentUser(req).role !== 'admin' && share.ownerId !== currentUser(req).id)) return reply.code(404).send({ error: 'NOT_FOUND' });
  const ok = await store.revokeShare(token);
  return ok ? { ok: true } : reply.code(404).send({ error: 'NOT_FOUND' });
});

app.post('/api/share', async (req, reply) => {
  if (!a.require(req, reply)) return;
  const body = req.body as { recordId?: string; recordIds?: string[]; folderId?: string; days?: number } | undefined;
  const folder = body?.folderId ? store.getFolder(body.folderId) : undefined;
  if (body?.folderId && (!folder || !canAccessFolder(req, body.folderId))) return reply.code(404).send({ error: 'FOLDER_NOT_FOUND' });
  const ids = folder
    ? store.listRecords(scopeOwner(req)).filter((r) => r.folderId === folder.id).map((r) => r.id)
    : (body?.recordIds?.length ? body.recordIds : body?.recordId ? [body.recordId] : []).filter(Boolean);
  if (!ids.length) return reply.code(400).send({ error: 'MISSING_RECORD' });
  if (!folder && ids.some((id) => { const r = store.getRecord(id); return !r || !canAccessRecord(req, r); })) return reply.code(404).send({ error: 'NOT_FOUND' });
  const days = Math.min(30, Math.max(1, body?.days ?? 7));
  const share = await store.createShare(ids, days * 86400_000, folder ? { folderId: folder.id, folderName: folder.name, ownerId: currentUser(req).id } : { ownerId: currentUser(req).id });
  return { url: `/s/${share.token}`, expiresAt: share.expiresAt, count: ids.length, folderName: share.folderName };
});

app.get('/s/:token', async (req, reply) => {
  const { token } = req.params as { token: string };
  const share = store.getShare(token);
  if (!share) return reply.code(410).type('text/html').send('<h1>链接已过期</h1>');
  const records = share.recordIds.map((id) => store.getRecord(id)).filter(Boolean);
  const cards = records
    .map((r) => `<figure><img src="/s/${token}/img/${r!.id}?v=${imageVersion(r)}" alt=""><figcaption>${escapeHtml(r!.templateName)} · ${new Date(r!.createdAt).toLocaleString()}</figcaption></figure>`)
    .join('');
  reply.type('text/html').header('Cache-Control', 'no-store').send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>水印照片分享</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;margin:0;background:#f6f7f9;color:#111}header{padding:16px 20px;background:#0f766e;color:#fff}main{padding:12px;display:grid;gap:14px}figure{margin:0;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px #0001}img{display:block;width:100%;height:auto}figcaption{padding:8px 12px;font-size:13px;color:#555}</style></head>
<body><header>水印照片分享 · 只读 <a href="/s/${token}/zip" style="float:right;color:#fff;font-size:13px">下载全部 ZIP</a></header><main>${cards || '<p>没有可显示的记录</p>'}</main></body></html>`);
});

app.get('/s/:token/zip', async (req, reply) => {
  const { token } = req.params as { token: string };
  const share = store.getShare(token);
  if (!share) return reply.code(410).send({ error: 'EXPIRED' });
  const records = share.recordIds.map((id) => store.getRecord(id)).filter(Boolean) as any[];
  if (!records.length) return reply.code(404).send({ error: 'NOT_FOUND' });
  reply.header('Content-Type', 'application/zip');
  reply.header('Content-Disposition', `attachment; filename="watermark-share-${token.slice(0, 8)}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => app.log.error({ err }, 'share zip error'));
  for (const r of records) {
    const name = `${String(r.values.modelo || r.id).replace(/[^a-zA-Z0-9._-]+/g, '_')}.jpg`;
    archive.append(await storage.getObject(r.renderKey), { name });
  }
  await archive.finalize();
  return reply.send(archive);
});

app.get('/s/:token/img/:id', async (req, reply) => {
  const { token, id } = req.params as { token: string; id: string };
  const share = store.getShare(token);
  if (!share || !share.recordIds.includes(id)) return reply.code(404).send({ error: 'NOT_FOUND' });
  const r = store.getRecord(id);
  if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
  return sendObject(reply, r.renderKey, 'public, max-age=300');
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

await store.init();
let admin = store.getUserByUsername('admin');
if (!admin) {
  admin = { id: randomUUID(), username: 'admin', passwordHash: hashPassword(adminPassword), role: 'admin', createdAt: Date.now() };
  await store.addUser(admin);
}
await store.migrateOwner(admin.id);
for (const e of store.listExports()) {
  if (e.status === 'queued' || e.status === 'running') {
    e.status = 'failed';
    e.error = 'server restarted before export finished';
    await store.updateExport(e);
  }
}
await cleanupExports();
await mkdir(dataDir, { recursive: true });

try {
  await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.raw.url?.startsWith('/api/') || req.raw.url?.startsWith('/s/')) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }
    try {
      const html = await readFile(join(webDist, 'index.html'));
      return reply.type('text/html').send(html);
    } catch {
      return reply.code(404).send('Web build not found. Run npm run build -w apps/web');
    }
  });
} catch (e) {
  app.log.warn({ e }, 'web dist not found; API only');
}

await app.listen({ port, host });
app.log.info(`watermark-camera listening on http://${host}:${port}`);
