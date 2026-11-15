import { describe, expect, it } from 'vitest';
import { canonicalSpec, makeSpec, specHash } from '../src/spec.js';

describe('spec', () => {
  it('normalizes scale/opacity and trims values', () => {
    const spec = makeSpec({ templateId: 'minimal', scale: 9, opacity: -1, values: { modelo: '  A  ' } });
    expect(spec.scale).toBe(2);
    expect(spec.opacity).toBe(0.3);
    expect(spec.values.modelo).toBe('A');
  });

  it('is deterministic regardless of key order', () => {
    const a = makeSpec({ templateId: 'minimal', values: { b: '2', a: '1' } });
    const b = makeSpec({ templateId: 'minimal', values: { a: '1', b: '2' } });
    expect(JSON.stringify(canonicalSpec(a))).toBe(JSON.stringify(canonicalSpec(b)));
  });

  it('hashes stably and changes when the spec changes', async () => {
    const a = makeSpec({ templateId: 'minimal', values: { modelo: 'A' } });
    const b = makeSpec({ templateId: 'minimal', values: { modelo: 'A' } });
    const c = makeSpec({ templateId: 'minimal', values: { modelo: 'B' } });
    expect(await specHash(a)).toBe(await specHash(b));
    expect(await specHash(a)).not.toBe(await specHash(c));
  });
});
