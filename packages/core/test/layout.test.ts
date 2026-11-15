import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/layout.js';
import { makeSpec } from '../src/spec.js';
import { getTemplateById } from '../src/templates.js';
import { makeFakeCtx } from './fakeCanvas.js';

const tpl = getTemplateById('minimal')!;

describe('computeLayout', () => {
  it('returns null when all fields are empty', () => {
    const ctx = makeFakeCtx();
    const layout = computeLayout(ctx, tpl, makeSpec({ templateId: tpl.id }), 1080, 1440);
    expect(layout).toBeNull();
  });

  it('renders label and content lines for a value', () => {
    const ctx = makeFakeCtx();
    const layout = computeLayout(
      ctx,
      tpl,
      makeSpec({ templateId: tpl.id, values: { modelo: 'RL-034', precio: '¥11' } }),
      1080,
      1440,
    );
    expect(layout).not.toBeNull();
    expect(layout!.lines.some((l) => l.text.includes('RL-034'))).toBe(true);
    expect(layout!.lines.some((l) => l.isLabel)).toBe(true);
    expect(layout!.x).toBeGreaterThanOrEqual(0);
    expect(layout!.y).toBeGreaterThanOrEqual(0);
  });

  it('uses the requested 9-grid position', () => {
    const ctx = makeFakeCtx();
    const spec = makeSpec({ templateId: tpl.id, position: 'top-left', values: { modelo: 'X' } });
    const layout = computeLayout(ctx, tpl, spec, 1080, 1440)!;
    expect(layout.x).toBe(Math.round(1080 * 0.04));
    expect(layout.y).toBe(Math.round(1080 * 0.04));
  });

  it('scales font size with spec.scale', () => {
    const ctx = makeFakeCtx();
    const a = computeLayout(ctx, tpl, makeSpec({ templateId: tpl.id, values: { modelo: 'X' }, scale: 1 }), 1080, 1440)!;
    const b = computeLayout(ctx, tpl, makeSpec({ templateId: tpl.id, values: { modelo: 'X' }, scale: 1.5 }), 1080, 1440)!;
    expect(b.fontSize).toBeGreaterThan(a.fontSize);
    expect(b.width).toBeGreaterThan(a.width);
  });

  it('wraps long Spanish text', () => {
    const ctx = makeFakeCtx();
    const long = '6 estrellas grande + 6 estrellas chicas + 8 secuencias + sin musica + con luz y movimiento';
    const layout = computeLayout(ctx, tpl, makeSpec({ templateId: tpl.id, values: { desEs: long } }), 1080, 1440)!;
    expect(layout.lines.length).toBeGreaterThan(2);
  });
});
