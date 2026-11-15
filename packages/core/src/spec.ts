import { FONT_VERSION, RENDERER_VERSION, type Position, type WatermarkSpec } from './types.js';

const POSITIONS: Position[] = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

export function isPosition(value: unknown): value is Position {
  return typeof value === 'string' && POSITIONS.includes(value as Position);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function trimValues(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(values).sort()) {
    const v = values[key];
    if (v != null) out[key] = String(v).trim();
  }
  return out;
}

function sortObject<T>(obj: T): T {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    out[key] = (obj as Record<string, unknown>)[key];
  }
  return out as T;
}

export function canonicalSpec(spec: WatermarkSpec): WatermarkSpec {
  return {
    templateId: spec.templateId,
    templateVersion: Number(spec.templateVersion) || 1,
    position: isPosition(spec.position) ? spec.position : 'bottom-center',
    x: spec.x == null ? null : Math.round(spec.x),
    y: spec.y == null ? null : Math.round(spec.y),
    scale: clamp(round3(spec.scale || 1), 0.5, 2),
    heightScale: clamp(round3(spec.heightScale ?? 1), 0.5, 2.5),
    opacity: clamp(round3(spec.opacity ?? 0.85), 0.3, 1),
    widthRatio: clamp(round3(spec.widthRatio || 0.42), 0.28, 0.85),
    styleOverrides: sortObject({ ...(spec.styleOverrides ?? {}) }),
    values: trimValues(spec.values ?? {}),
    rendererVersion: spec.rendererVersion || RENDERER_VERSION,
  };
}

export function canonicalSpecJson(spec: WatermarkSpec): string {
  return JSON.stringify(canonicalSpec(spec));
}

/** SHA-256 of canonical spec + renderer/font versions. */
export async function specHash(spec: WatermarkSpec): Promise<string> {
  const data = new TextEncoder().encode(`${canonicalSpecJson(spec)}|${FONT_VERSION}|${RENDERER_VERSION}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeSpec(input: Partial<WatermarkSpec> & { templateId: string }): WatermarkSpec {
  return canonicalSpec({
    templateId: input.templateId,
    templateVersion: input.templateVersion ?? 1,
    position: input.position ?? 'bottom-center',
    x: input.x ?? null,
    y: input.y ?? null,
    scale: input.scale ?? 1,
    heightScale: input.heightScale ?? 1,
    opacity: input.opacity ?? 0.85,
    widthRatio: input.widthRatio ?? 0.42,
    styleOverrides: input.styleOverrides ?? {},
    values: input.values ?? {},
    rendererVersion: input.rendererVersion ?? RENDERER_VERSION,
  });
}
