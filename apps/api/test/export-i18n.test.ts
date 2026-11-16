import { describe, expect, it, vi } from 'vitest';
import {
  analyzeLanguage,
  detectLanguage,
  maskWhitelist,
  normalizeTranslationConfig,
  resolveBilingualFields,
  restoreWhitelist,
  type TranslateFn,
} from '../src/export-i18n.js';

const basicTranslator: TranslateFn = async ({ maskedText, from }) => {
  if (from === 'zh') return maskedText.replace(/[\u3400-\u9fff]+/g, 'texto');
  return maskedText.replace(/[A-Za-z\u00c0-\u00ff]+/g, '文字');
};

describe('language detection', () => {
  it('detects Chinese and Spanish', () => {
    expect(detectLanguage('六个大星星')).toBe('zh');
    expect(detectLanguage('seis estrellas grandes')).toBe('es');
    expect(detectLanguage('Español con acentos: á é í ó ú ñ ü')).toBe('es');
  });

  it('ignores whitelist phrases and product codes', () => {
    expect(detectLanguage('大星星 USB Type-C', ['USB', 'Type-C'])).toBe('zh');
    expect(detectLanguage('USB Type-C', ['USB', 'Type-C'])).toBe('unknown');
    expect(detectLanguage('USB Type-C')).toBe('unknown');
    expect(detectLanguage('ABC-123')).toBe('unknown');
    expect(detectLanguage('6pcs')).toBe('unknown');
    expect(detectLanguage('6个')).toBe('unknown');
    expect(detectLanguage('—')).toBe('unknown');
  });

  it('uses the translatable-content ratio for mixed text', () => {
    expect(detectLanguage('大星星大星星大星星 sol', ['sol'])).toBe('zh');
    expect(detectLanguage('大星星 estrellas grandes')).toBe('es');
    const stats = analyzeLanguage('大星星 estrellas grandes');
    expect(stats.cjk).toBeGreaterThan(0);
    expect(stats.latin).toBeGreaterThan(stats.cjk);
  });
});

describe('whitelist masking', () => {
  it('masks longest phrases first and restores them', () => {
    const masked = maskWhitelist('USB Type-C 大星星', ['USB', 'Type-C']);
    expect(masked.masked).not.toContain('Type-C');
    expect(masked.masked).not.toContain('USB');
    expect(restoreWhitelist(`${masked.masked} extra`, masked)).toContain('Type-C');
    expect(restoreWhitelist(`${masked.masked} extra`, masked)).toContain('USB');
  });

  it('rejects a translation that dropped a protected phrase', () => {
    const masked = maskWhitelist('大星星 USB', ['USB']);
    expect(restoreWhitelist('texto', masked)).toBeNull();
  });
});

describe('bilingual column normalisation', () => {
  it('puts Chinese original in D and Spanish translation in C', async () => {
    const result = await resolveBilingualFields({ desEs: '六个大星星', desZh: '' }, { translate: basicTranslator });
    expect(result.c).toContain('texto');
    expect(result.d).toBe('六个大星星');
    expect(result.status).toBe('translated');
    expect(result.sourceLang).toBe('zh');
  });

  it('puts Spanish original in C and Chinese translation in D', async () => {
    const result = await resolveBilingualFields({ desEs: '', desZh: 'seis estrellas grandes' }, { translate: basicTranslator });
    expect(result.c).toBe('seis estrellas grandes');
    expect(result.d).toContain('文字');
    expect(result.status).toBe('translated');
    expect(result.sourceLang).toBe('es');
  });

  it('repairs a swapped pair without translating', async () => {
    const translate = vi.fn(basicTranslator);
    const result = await resolveBilingualFields({
      desEs: '六个大星星',
      desZh: 'seis estrellas grandes',
    }, { translate });
    expect(result.c).toBe('seis estrellas grandes');
    expect(result.d).toBe('六个大星星');
    expect(result.status).toBe('original_pair');
    expect(translate).not.toHaveBeenCalled();
  });

  it('keeps whitelist phrases unchanged in the translated column', async () => {
    const result = await resolveBilingualFields({
      desEs: '',
      desZh: '大星星 USB Type-C',
    }, {
      whitelist: ['USB', 'Type-C'],
      translate: async ({ maskedText }) => `[[W0]] [[W1]] ${maskedText.replace(/大星星/g, 'grandes estrellas')}`,
    });
    expect(result.d).toBe('大星星 USB Type-C');
    expect(result.c).toContain('USB');
    expect(result.c).toContain('Type-C');
  });

  it('preserves unknown/code-only text in both columns', async () => {
    const translate = vi.fn(basicTranslator);
    const result = await resolveBilingualFields({ desEs: '', desZh: 'USB Type-C' }, {
      whitelist: ['USB', 'Type-C'],
      translate,
    });
    expect(result.c).toBe('USB Type-C');
    expect(result.d).toBe('USB Type-C');
    expect(result.status).toBe('unknown');
    expect(translate).not.toHaveBeenCalled();
  });

  it('treats placeholders as empty', async () => {
    const result = await resolveBilingualFields({ desEs: '—', desZh: '—' }, { translate: basicTranslator });
    expect(result).toMatchObject({ c: '', d: '', status: 'empty' });
  });

  it('falls back to the original when translation fails', async () => {
    const result = await resolveBilingualFields({ desEs: '六个大星星', desZh: '' }, {
      translate: async () => null,
    });
    expect(result.c).toBe('');
    expect(result.d).toBe('六个大星星');
    expect(result.status).toBe('failed');
  });

  it('marks a translation that dropped a whitelist placeholder as failed', async () => {
    const result = await resolveBilingualFields({ desEs: '大星星 USB', desZh: '' }, {
      whitelist: ['USB'],
      translate: async () => 'grandes estrellas',
    });
    expect(result.c).toBe('');
    expect(result.d).toBe('大星星 USB');
    expect(result.status).toBe('failed');
  });

  it('keeps both Chinese columns but translates the longer original', async () => {
    const result = await resolveBilingualFields({ desEs: '大星星', desZh: '大星星大星星' }, { translate: basicTranslator });
    expect(result.d).toBe('大星星大星星');
    expect(result.c).toContain('texto');
    expect(result.status).toBe('translated');
  });

  it('keeps both Spanish columns but translates the longer original', async () => {
    const result = await resolveBilingualFields({ desEs: 'estrellas grandes', desZh: 'sol' }, { translate: basicTranslator });
    expect(result.c).toBe('estrellas grandes');
    expect(result.d).toContain('文字');
    expect(result.status).toBe('translated');
  });

  it('preserves an unknown extra field beside a known original', async () => {
    const result = await resolveBilingualFields({ desEs: 'USB', desZh: '六个大星星' }, {
      whitelist: ['USB'],
      translate: basicTranslator,
    });
    expect(result.d).toBe('六个大星星');
    expect(result.c).toContain('texto');
    expect(result.c).toContain('USB');
  });

  it('preserves an unknown desZh field when the Chinese original is in desEs', async () => {
    const result = await resolveBilingualFields({ desEs: '六个大星星', desZh: 'USB' }, {
      whitelist: ['USB'],
      translate: basicTranslator,
    });
    expect(result.d).toContain('六个大星星');
    expect(result.d).toContain('USB');
    expect(result.c).toContain('texto');
  });
});

describe('translation config', () => {
  it('uses the built-in proper-noun whitelist for a fresh account', () => {
    const config = normalizeTranslationConfig(undefined);
    expect(config.whitelist).toEqual(['USB', 'Type-C']);
    const configured = normalizeTranslationConfig({ whitelist: [] });
    expect(configured.whitelist).toEqual([]);
  });

  it('sanitises values and limits list sizes', () => {
    const config = normalizeTranslationConfig({
      priority: 'free-local-llm',
      freeEnabled: false,
      whitelist: [' USB ', 'USB', '', 'Type-C'],
      dictPairs: [{ zh: '大星星', es: 'estrella' }, { zh: '', es: 'x' }],
    });
    expect(config.priority).toBe('free-local-llm');
    expect(config.freeEnabled).toBe(false);
    expect(config.whitelist).toEqual(['USB', 'Type-C']);
    expect(config.dictPairs).toEqual([{ zh: '大星星', es: 'estrella' }]);
  });
});
