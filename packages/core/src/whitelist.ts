export interface MaskPair {
  phrase: string;
  token: string;
}

export interface MaskedText {
  masked: string;
  masks: MaskPair[];
}

/**
 * Built-in proper nouns / units / currencies. Every entry is deletable by the
 * user once account settings are saved; this is only the starting set.
 */
export const DEFAULT_WHITELIST = [
  // Volume / area
  'm³', 'm3', 'm²', 'm2', '㎡', 'cm³', 'cm3', 'cm²', 'cm2',
  // Weight
  'kg', 'g', 'mg', 't', 'lb', 'lbs', 'oz',
  // Capacity
  'L', 'l', 'ml', 'mL',
  // Quantity / packaging
  'pzs', 'pzas', 'pcs', 'pc', 'ctn', 'ctns', 'cajas', 'caja', 'unidades', 'uds',
  // Currency codes
  'rmb', 'RMB', 'usd', 'USD', 'eur', 'EUR',
  // Currency symbols
  '¥', '$', '€',
  // Physical / electrical / common abbreviations
  'RGB', 'LED', 'USB', 'Type-C', 'DC', 'AC', 'W', 'V', 'ma', 'mA', 'HZ', 'Hz',
  'kW', 'kV', 'kWh', 'mAh', 'kHz', 'MHz', 'GHz', '°C', '°F',
  // Length
  'mm', 'cm', 'dm', 'm', 'km', 'in', 'ft',
];

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phrasePattern(phrase: string): RegExp {
  const escaped = escapeRegExp(phrase);
  // Symbols and CJK phrases are matched literally. Latin abbreviations need
  // letter boundaries so `g` does not eat the g in "grande" and `pc` does not
  // match inside `pcs`; digits are allowed so `10kg`, `20W`, `500ma` still hit.
  if (!/[A-Za-z\u00c0-\u00ff]/.test(phrase) || /[\u3400-\u9fff]/.test(phrase)) {
    return new RegExp(escaped, 'g');
  }
  return new RegExp(`(?<![A-Za-z\u00c0-\u00ff])${escaped}(?![A-Za-z\u00c0-\u00ff])`, 'g');
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
    if (!phrasePattern(phrase).test(masked)) continue;
    let token = `[[${masks.length}]]`;
    while (masked.includes(token)) token = `_${token}`;
    masks.push({ phrase, token });
    masked = masked.replace(phrasePattern(phrase), token);
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
    if (found.length === 0 && masked.masks.every((m) => phrasePattern(m.phrase).test(text))) return text;
    return null;
  }
  let out = text;
  for (const { phrase, token } of masked.masks) out = out.split(token).join(phrase);
  return out;
}
