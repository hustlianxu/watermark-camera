export type Language = 'zh' | 'es' | 'unknown';
export type TranslationPriority = 'local-free-llm' | 'free-local-llm' | 'llm-local-free';
export type BilingualStatus = 'empty' | 'translated' | 'original_pair' | 'unknown' | 'failed';

export interface DictPair {
  zh: string;
  es: string;
}

export interface TranslationConfig {
  priority: TranslationPriority;
  freeEnabled: boolean;
  dictPairs: DictPair[];
  whitelist: string[];
}

export interface MaskPair {
  phrase: string;
  token: string;
}

export interface MaskedText {
  masked: string;
  masks: MaskPair[];
}

export interface TranslateInput {
  /** Original, trimmed source text. Useful for exact local-dictionary hits. */
  text: string;
  /** Text with whitelist phrases replaced by placeholders. Free/LLM engines must use this. */
  maskedText: string;
  masks: MaskPair[];
  from: 'zh' | 'es';
  to: 'zh' | 'es';
}

export type TranslateFn = (input: TranslateInput) => Promise<string | null>;

export interface BilingualResult {
  /** Spanish column: DETALLADOS */
  c: string;
  /** Chinese column: 描述 */
  d: string;
  sourceLang: Language;
  status: BilingualStatus;
  cjk: number;
  latin: number;
}

export interface ResolveOptions {
  whitelist?: string[];
  translate: TranslateFn;
  /** Per-export cache. Key is direction + source text. */
  cache?: Map<string, string | null>;
}

export const DEFAULT_WHITELIST = ['USB', 'Type-C'];

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  priority: 'local-free-llm',
  freeEnabled: true,
  dictPairs: [],
  whitelist: [...DEFAULT_WHITELIST],
};

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_RE = /[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]/g;
const HAS_LOWERCASE_LATIN_RE = /[a-z\u00df-\u00f6\u00f8-\u00ff]/;
const PLACEHOLDER_RE = /^[\s—–\-]+$|^(?:n\/?a|none|null|无|暂无)$/i;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

export function isPlaceholder(value: unknown): boolean {
  return PLACEHOLDER_RE.test(asText(value));
}

/** Remove duplicate/blank whitelist terms. Case-sensitive, longest-first at use time. */
export function normalizeWhitelist(words: unknown): string[] {
  if (!Array.isArray(words)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    const value = asText(word).slice(0, 120);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.slice(0, 500);
}

/**
 * Replace whitelist phrases with stable placeholders before sending text to a
 * translation engine. Repeated phrases share one placeholder.
 */
export function maskWhitelist(text: string, whitelist: unknown): MaskedText {
  const masks: MaskPair[] = [];
  let masked = String(text ?? '');
  const words = normalizeWhitelist(whitelist).sort((a, b) => b.length - a.length);
  for (const phrase of words) {
    if (!masked.includes(phrase)) continue;
    let token = `[[W${masks.length}]]`;
    while (masked.includes(token)) token = `_${token}`;
    masks.push({ phrase, token });
    masked = masked.split(phrase).join(token);
  }
  return { masked, masks };
}

/**
 * Restore placeholders. Returns null when a translation engine dropped or
 * rewrote a placeholder and no longer preserved the original whitelist phrase.
 */
export function restoreWhitelist(text: string, masked: MaskedText): string | null {
  if (!masked.masks.length) return text;
  const found = masked.masks.filter((m) => text.includes(m.token));
  if (found.length !== masked.masks.length) {
    // Some engines (notably a local dictionary hit) may return the phrase
    // verbatim instead of the placeholder. Accept only if every phrase survived.
    if (found.length === 0 && masked.masks.every((m) => text.includes(m.phrase))) return text;
    return null;
  }
  let out = text;
  for (const { phrase, token } of masked.masks) out = out.split(token).join(phrase);
  return out;
}

export interface LanguageStats {
  lang: Language;
  cjk: number;
  latin: number;
}

/**
 * Language signal after removing whitelist phrases, URLs, e-mails, numbers,
 * numeric product codes, units and punctuation.
 *
 * Chinese if CJK characters are at least half of the remaining letters,
 * Spanish otherwise. Text with no translatable letters is "unknown".
 */
export function analyzeLanguage(text: string, whitelist: unknown = DEFAULT_WHITELIST): LanguageStats {
  let value = maskWhitelist(text, whitelist).masked;
  value = value.replace(/\[\[W\d+\]\]/g, ' ');
  value = value.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ');
  value = value.replace(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/gi, ' ');
  // Numeric product codes / dimensions / sizes: ABC-123, 10x20cm, 6pcs.
  value = value.replace(/\b[A-Za-z][A-Za-z0-9._/+-]*\d[A-Za-z0-9._/+-]*\b/g, ' ');
  value = value.replace(/\d+(?:[.,]\d+)?/g, ' ');
  value = value.replace(
    /\b(?:mm|cm|dm|km|kg|mg|ml|pcs?|pc|sets?|boxes?|box|inches?|inch|in|ft|oz|lbs?|mah|gb|tb|kw|w|v)\b/gi,
    ' ',
  );
  // Chinese counting units are not translatable content by themselves.
  value = value.replace(/[个箱件套只条张包对支台片盒卷双]/g, ' ');

  const cjk = value.match(CJK_RE)?.length ?? 0;
  const latin = value.match(LATIN_RE)?.length ?? 0;
  if (!cjk && !latin) return { lang: 'unknown', cjk, latin };
  if (!latin) return { lang: 'zh', cjk, latin };
  if (!cjk) {
    // An all-uppercase Latin token is usually a model/code; do not let it
    // force a full Spanish translation. It is preserved as unknown instead.
    if (!HAS_LOWERCASE_LATIN_RE.test(value)) return { lang: 'unknown', cjk, latin };
    return { lang: 'es', cjk, latin };
  }
  return { lang: cjk / (cjk + latin) >= 0.5 ? 'zh' : 'es', cjk, latin };
}

export function detectLanguage(text: string, whitelist: unknown = DEFAULT_WHITELIST): Language {
  return analyzeLanguage(text, whitelist).lang;
}

function addPreserved(base: string, extra: string): string {
  if (!extra || base.includes(extra)) return base;
  if (!base) return extra;
  return `${base}${base.includes('\n') ? '\n' : ' '}${extra}`;
}

async function translateFrom(
  source: string,
  sourceLang: 'zh' | 'es',
  options: ResolveOptions,
  extra: { text?: string; side?: 'c' | 'd' } = {},
): Promise<BilingualResult> {
  const to = sourceLang === 'zh' ? 'es' : 'zh';
  const masked = maskWhitelist(source, options.whitelist ?? []);
  const cacheKey = `${sourceLang}|${to}|${source}`;
  let translated: string | null | undefined = options.cache?.get(cacheKey);
  if (translated === undefined) {
    try {
      translated = await options.translate({
        text: source,
        maskedText: masked.masked,
        masks: masked.masks,
        from: sourceLang,
        to,
      });
    } catch {
      translated = null;
    }
    options.cache?.set(cacheKey, translated ?? null);
  }

  const raw = translated?.trim() ?? '';
  const restored = raw ? restoreWhitelist(raw, masked) : null;
  if (!restored || !restored.trim() || restored.trim() === source) {
    return {
      c: sourceLang === 'es' ? source : '',
      d: sourceLang === 'zh' ? source : '',
      sourceLang,
      status: 'failed',
      cjk: analyzeLanguage(source, options.whitelist).cjk,
      latin: analyzeLanguage(source, options.whitelist).latin,
    };
  }

  const stats = analyzeLanguage(source, options.whitelist);
  let c = sourceLang === 'es' ? source : restored.trim();
  let d = sourceLang === 'zh' ? source : restored.trim();
  if (extra.text) {
    if (extra.side === 'c') c = addPreserved(c, extra.text);
    else if (extra.side === 'd') d = addPreserved(d, extra.text);
  }
  return {
    c,
    d,
    sourceLang,
    status: 'translated',
    cjk: stats.cjk,
    latin: stats.latin,
  };
}

/**
 * Decide which description is the original and which column gets the
 * translation. Never blindly trusts the field name: either field may contain
 * Chinese or Spanish.
 */
export async function resolveBilingualFields(
  values: Record<string, unknown> | undefined,
  options: ResolveOptions,
): Promise<BilingualResult> {
  options = { ...options, whitelist: options.whitelist ?? DEFAULT_WHITELIST };
  const rawEs = asText(values?.desEs);
  const rawZh = asText(values?.desZh);
  const es = isPlaceholder(rawEs) ? '' : rawEs;
  const zh = isPlaceholder(rawZh) ? '' : rawZh;
  const aEs = analyzeLanguage(es, options.whitelist);
  const aZh = analyzeLanguage(zh, options.whitelist);

  if (!es && !zh) {
    return { c: '', d: '', sourceLang: 'unknown', status: 'empty', cjk: 0, latin: 0 };
  }

  if (!es || !zh) {
    const source = es || zh;
    const stats = es ? aEs : aZh;
    if (stats.lang === 'unknown') {
      // Proper nouns, codes, units only: no reliable direction. Keep the text
      // visible in both language columns rather than silently dropping it.
      return { c: source, d: source, sourceLang: 'unknown', status: 'unknown', cjk: stats.cjk, latin: stats.latin };
    }
    return translateFrom(source, stats.lang, options);
  }

  // Both fields filled: normalise swapped values before doing any translation.
  if (aEs.lang === 'es' && aZh.lang === 'zh') {
    return { c: es, d: zh, sourceLang: 'es', status: 'original_pair', cjk: aZh.cjk, latin: aEs.latin };
  }
  if (aEs.lang === 'zh' && aZh.lang === 'es') {
    return { c: zh, d: es, sourceLang: 'es', status: 'original_pair', cjk: aEs.cjk, latin: aZh.latin };
  }

  if (aEs.lang === aZh.lang && (aEs.lang === 'zh' || aEs.lang === 'es')) {
    const lang = aEs.lang;
    // Tie goes to the field traditionally used for that language.
    const source = lang === 'zh'
      ? (zh.replace(/\s/g, '').length >= es.replace(/\s/g, '').length ? zh : es)
      : (es.replace(/\s/g, '').length >= zh.replace(/\s/g, '').length ? es : zh);
    return translateFrom(source, lang, options);
  }

  if (aEs.lang !== 'unknown') {
    return translateFrom(es, aEs.lang, options, { text: zh, side: 'd' });
  }
  if (aZh.lang !== 'unknown') {
    return translateFrom(zh, aZh.lang, options, { text: es, side: 'c' });
  }
  // No usable language signal at all.
  return { c: es, d: zh, sourceLang: 'unknown', status: 'unknown', cjk: aEs.cjk + aZh.cjk, latin: aEs.latin + aZh.latin };
}

export function translationStatusText(status: BilingualStatus): string {
  switch (status) {
    case 'translated': return '已翻译';
    case 'original_pair': return '原文齐全';
    case 'unknown': return '保留原文';
    case 'failed': return '翻译失败';
    default: return '';
  }
}

export function normalizeTranslationConfig(input: unknown): TranslationConfig {
  const value = (input ?? {}) as Partial<TranslationConfig>;
  const priority: TranslationPriority = value.priority === 'free-local-llm' || value.priority === 'llm-local-free'
    ? value.priority
    : 'local-free-llm';
  const dictPairs: DictPair[] = [];
  if (Array.isArray(value.dictPairs)) {
    for (const pair of value.dictPairs.slice(0, 500)) {
      const zh = asText((pair as DictPair | undefined)?.zh).slice(0, 200);
      const es = asText((pair as DictPair | undefined)?.es).slice(0, 200);
      if (zh && es) dictPairs.push({ zh, es });
    }
  }
  return {
    priority,
    freeEnabled: value.freeEnabled !== false,
    dictPairs,
    whitelist: Array.isArray(value.whitelist)
      ? normalizeWhitelist(value.whitelist)
      : [...DEFAULT_WHITELIST],
  };
}
