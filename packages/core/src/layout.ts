import { parseColor } from './colors.js';
import { clamp } from './spec.js';
import { wrapText } from './text.js';
import type {
  Canvas2DLike,
  LayoutResult,
  RenderedLine,
  TemplateStyle,
  WatermarkSpec,
  WatermarkTemplate,
} from './types.js';
import { FONT_FAMILY } from './types.js';

export const LABEL_COLOR = '#ffe58f';

function resolveStyle(template: WatermarkTemplate, spec: WatermarkSpec): TemplateStyle {
  return { ...template.style, ...(spec.styleOverrides ?? {}) };
}

function positionX(position: string, cw: number, blockW: number, margin: number): number {
  if (position.includes('left')) return margin;
  if (position.includes('right')) return cw - blockW - margin;
  return (cw - blockW) / 2;
}

function positionY(position: string, ch: number, blockH: number, margin: number): number {
  if (position.includes('top')) return margin;
  if (position.includes('center')) return (ch - blockH) / 2;
  return ch - blockH - margin;
}

export function computeLayout(
  ctx: Canvas2DLike,
  template: WatermarkTemplate,
  spec: WatermarkSpec,
  cw: number,
  ch: number,
): LayoutResult | null {
  const style = resolveStyle(template, spec);
  const ratio = cw / 750;
  const scale = clamp(spec.scale || 1, 0.5, 2);
  const heightScale = clamp(spec.heightScale ?? 1, 0.5, 2.5);
  const widthRatio = clamp(spec.widthRatio || template.widthRatio || 0.42, 0.28, 0.85);
  const fontSize = Math.max(14, Math.round(style.fontSize * ratio * scale));
  const lineHeight = Math.round(fontSize * (style.lineHeight || 1.35) * heightScale);
  const padding = Math.round((style.padding || 14) * ratio * scale);
  const borderRadius = Math.round((style.borderRadius || 10) * ratio);
  const blockW = Math.round(cw * widthRatio * scale);
  const indent = Math.round(fontSize * 1.4);
  const textInnerW = Math.max(1, blockW - padding * 2);
  const isWide = widthRatio >= 0.5;

  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'top';

  const lines: RenderedLine[] = [];
  for (const field of template.fields || []) {
    const raw = spec.values?.[field.key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value) continue;

    const labelText = `${field.label}:`;
    const isMultiline = field.multiline || field.type === 'textarea' || value.includes('\n');

    if (isWide && !isMultiline) {
      const combined = `${labelText} ${value}`;
      if (ctx.measureText(combined).width <= textInnerW) {
        lines.push({
          fieldKey: field.key,
          text: combined,
          isLabel: false,
          isInline: true,
          labelPart: labelText,
          valuePart: value,
          color: style.color,
        });
        continue;
      }
    }

    lines.push({ fieldKey: field.key, text: labelText, isLabel: true, isInline: false, color: LABEL_COLOR });
    const paragraphs = value.split(/\r?\n/);
    for (const p of paragraphs) {
      if (!p.trim()) {
        if (paragraphs.length > 1) lines.push({ fieldKey: field.key, text: '', isLabel: false, isInline: false, color: style.color });
        continue;
      }
      for (const sub of wrapText(ctx, p, Math.max(1, textInnerW - indent))) {
        lines.push({ fieldKey: field.key, text: sub, isLabel: false, isInline: false, color: style.color });
      }
    }
  }

  if (lines.length === 0) return null;

  const blockH = padding * 2 + lines.length * lineHeight;
  const margin = Math.round(cw * 0.04);
  let x = spec.x == null ? positionX(spec.position || template.position, cw, blockW, margin) : spec.x;
  let y = spec.y == null ? positionY(spec.position || template.position, ch, blockH, margin) : spec.y;
  x = clamp(x, margin, Math.max(margin, cw - blockW - margin));
  y = clamp(y, margin, Math.max(margin, ch - blockH - margin));

  return {
    x,
    y,
    width: blockW,
    height: blockH,
    fontSize,
    lineHeight,
    padding,
    borderRadius,
    backgroundColor: parseColor(style.background, spec.opacity),
    lines,
  };
}

export function drawWatermark(
  ctx: Canvas2DLike,
  template: WatermarkTemplate,
  spec: WatermarkSpec,
  cw: number,
  ch: number,
): LayoutResult | null {
  const layout = computeLayout(ctx, template, spec, cw, ch);
  if (!layout) return null;

  const { x, y, width, height, padding, lineHeight, fontSize, borderRadius } = layout;
  const style = resolveStyle(template, spec);
  const indent = Math.round(fontSize * 1.4);
  const textColor = parseColor(style.color || '#ffffff', 1);

  ctx.fillStyle = layout.backgroundColor;
  ctx.beginPath();
  const r = Math.min(borderRadius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();

  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.lineWidth = Math.max(2, Math.round(fontSize / 8));
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';

  layout.lines.forEach((line, index) => {
    if (!line.text) return;
    const isContent = !line.isLabel && !line.isInline;
    const tx = x + padding + (isContent ? indent : 0);
    const ty = y + padding + index * lineHeight;

    ctx.strokeText(line.text, tx, ty);
    if (line.isInline && line.labelPart) {
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(line.labelPart, tx, ty);
      const labelW = ctx.measureText(`${line.labelPart} `).width;
      ctx.fillStyle = textColor;
      ctx.fillText(line.valuePart || '', tx + labelW, ty);
    } else {
      ctx.fillStyle = line.isLabel ? LABEL_COLOR : textColor;
      ctx.fillText(line.text, tx, ty);
    }
  });

  return layout;
}
