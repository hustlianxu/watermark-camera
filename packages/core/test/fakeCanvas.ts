import type { Canvas2DLike } from '../src/types.js';

export function makeFakeCtx(): Canvas2DLike {
  let fontSize = 22;
  const ctx: Canvas2DLike & { calls: string[] } = {
    font: '',
    textBaseline: 'top',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    calls: [],
    measureText(text: string) {
      // Rough but deterministic: CJK = 1em, others = 0.55em.
      let width = 0;
      for (const ch of text) width += /[\u4e00-\u9fff]/.test(ch) ? fontSize : fontSize * 0.55;
      return { width };
    },
    fillText(text: string) { this.calls.push(`fill:${text}`); },
    strokeText(text: string) { this.calls.push(`stroke:${text}`); },
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fill() {},
  };
  Object.defineProperty(ctx, 'font', {
    get: () => `${fontSize}px sans-serif`,
    set: (v: string) => {
      const m = /(\d+(?:\.\d+)?)px/.exec(v);
      if (m) fontSize = Number(m[1]);
    },
  });
  return ctx;
}
