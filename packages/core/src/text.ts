import type { Canvas2DLike } from './types.js';

/** Wrap text by whitespace; overlong tokens are split per character. */
export function wrapText(ctx: Canvas2DLike, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const candidate = current ? current + (current.endsWith(' ') ? '' : ' ') + token : token;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current.trim());
    if (ctx.measureText(token).width <= maxWidth) {
      current = token;
      continue;
    }
    let sub = '';
    for (const ch of token) {
      const test = sub + ch;
      if (ctx.measureText(test).width > maxWidth && sub) {
        lines.push(sub);
        sub = ch;
      } else {
        sub = test;
      }
    }
    current = sub;
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}
