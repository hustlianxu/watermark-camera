import type { Canvas2DLike } from './types.js';

export function hexToRgba(hex: string, alpha: number): string {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Accepts #hex, rgb(), rgba(); applies alpha when provided. */
export function parseColor(color: string | undefined, alpha?: number): string {
  if (!color) return `rgba(0,0,0,${alpha ?? 0.6})`;
  const c = color.trim();
  if (c.startsWith('rgba(')) {
    if (alpha == null) return c;
    return c.replace(/[\d.]+\)$/, `${alpha})`);
  }
  if (c.startsWith('rgb(')) {
    if (alpha == null) return c.replace('rgb(', 'rgba(').replace(')', ', 1)');
    return c.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  if (c.startsWith('#')) return hexToRgba(c, alpha ?? 1);
  return c;
}

export function roundRect(
  ctx: Canvas2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
