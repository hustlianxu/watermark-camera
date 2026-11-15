import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { drawWatermark, getTemplateById, makeSpec, type WatermarkTemplate } from '@wc/core';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fontPath = join(here, '..', 'assets', 'fonts', 'NotoSansSC-Regular.otf');
let fontReady = false;

function ensureFont(): void {
  if (fontReady) return;
  try {
    GlobalFonts.registerFromPath(fontPath, 'Noto Sans SC');
    fontReady = true;
  } catch (e) {
    console.warn('[render] font registration failed', e);
  }
}

export interface RenderInput {
  original: Buffer;
  templateId: string;
  values: Record<string, string>;
  spec: Record<string, unknown>;
}

export interface RenderOutput {
  buffer: Buffer;
  width: number;
  height: number;
}

export async function renderRecord(input: RenderInput): Promise<RenderOutput> {
  ensureFont();
  const template = getTemplateById(input.templateId);
  if (!template) throw new Error('TEMPLATE_NOT_FOUND');
  const img = await loadImage(input.original);
  const maxEdge = 6000;
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const spec = makeSpec({
    templateId: input.templateId,
    ...(input.spec as any),
    values: input.values,
  });
  drawWatermark(ctx as any, template, spec, w, h);
  return { buffer: await canvas.encode('jpeg', 96), width: w, height: h };
}

export async function renderClean(original: Buffer): Promise<RenderOutput> {
  const img = await loadImage(original);
  const maxEdge = 6000;
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return { buffer: await canvas.encode('jpeg', 96), width: w, height: h };
}

export function getBuiltinTemplates(): WatermarkTemplate[] {
  return ['handwrite', 'minimal', 'handwriteSimple']
    .map((id) => getTemplateById(id))
    .filter((t): t is WatermarkTemplate => !!t);
}
