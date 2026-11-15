import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { drawWatermark } from '../src/layout.js';
import { makeSpec } from '../src/spec.js';
import { getTemplateById } from '../src/templates.js';

const tpl = getTemplateById('handwrite')!;

describe('drawWatermark', () => {
  it('draws onto a real canvas and returns a layout', () => {
    const canvas = createCanvas(1080, 1440);
    const ctx = canvas.getContext('2d');
    const layout = drawWatermark(
      ctx as any,
      tpl,
      makeSpec({
        templateId: tpl.id,
        values: { modelo: 'RL-034', desEs: '6 estrellas', precio: '¥11' },
      }),
      1080,
      1440,
    );
    expect(layout).not.toBeNull();
    expect(layout!.lines.length).toBeGreaterThan(0);
    const png = canvas.toBuffer('image/png');
    expect(png.length).toBeGreaterThan(1000);
    expect(png[0]).toBe(0x89);
    expect(png.slice(1, 4).toString()).toBe('PNG');
  });

  it('is deterministic for the same spec', () => {
    const spec = makeSpec({ templateId: tpl.id, values: { modelo: 'RL-034' } });
    const a = createCanvas(800, 1000);
    const b = createCanvas(800, 1000);
    drawWatermark(a.getContext('2d') as any, tpl, spec, 800, 1000);
    drawWatermark(b.getContext('2d') as any, tpl, spec, 800, 1000);
    expect(a.toBuffer('image/png').equals(b.toBuffer('image/png'))).toBe(true);
  });
});
