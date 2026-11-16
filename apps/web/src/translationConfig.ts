import { api } from './api';

export type TranslationPriority = 'local-free-llm' | 'free-local-llm' | 'llm-local-free';

export interface TranslationSettings {
  priority: TranslationPriority;
  freeEnabled: boolean;
  dictPairs: { zh: string; es: string }[];
  whitelist: string[];
}

export interface RemoteTranslationSettings extends TranslationSettings {
  configured?: boolean;
}

const DEFAULT_SETTINGS: TranslationSettings = {
  priority: 'local-free-llm',
  freeEnabled: true,
  dictPairs: [],
  whitelist: ['USB', 'Type-C'],
};

function parseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function readLocalTranslationSettings(): TranslationSettings {
  let dictPairs = parseArray<{ zh?: string; es?: string }>(localStorage.getItem('wc:dict-pairs'));
  if (!dictPairs.length) {
    try {
      const legacy = JSON.parse(localStorage.getItem('wc:dict') || '{}') as Record<string, unknown>;
      dictPairs = Object.entries(legacy).map(([zh, es]) => ({ zh, es: String(es) }));
    } catch {}
  }
  const rawWhitelist = localStorage.getItem('wc:whitelist-phrases');
  const whitelist = (rawWhitelist === null ? DEFAULT_SETTINGS.whitelist : parseArray<string>(rawWhitelist))
    .map((x) => String(x).trim())
    .filter(Boolean);
  return {
    priority: (localStorage.getItem('wc:trans-priority') as TranslationPriority) || DEFAULT_SETTINGS.priority,
    freeEnabled: localStorage.getItem('wc:free-enabled') !== '0',
    dictPairs: dictPairs
      .map((x) => ({ zh: String(x.zh ?? '').trim(), es: String(x.es ?? '').trim() }))
      .filter((x) => x.zh && x.es),
    whitelist: [...new Set(whitelist)],
  };
}

export function writeLocalTranslationSettings(value: TranslationSettings): void {
  localStorage.setItem('wc:trans-priority', value.priority);
  localStorage.setItem('wc:free-enabled', value.freeEnabled ? '1' : '0');
  localStorage.setItem('wc:dict-pairs', JSON.stringify(value.dictPairs));
  localStorage.setItem('wc:whitelist-phrases', JSON.stringify(value.whitelist));
}

function hasCustomSettings(value: TranslationSettings): boolean {
  const defaultWhitelist = [...DEFAULT_SETTINGS.whitelist].sort().join('\u0000');
  const whitelist = [...value.whitelist].sort().join('\u0000');
  return value.priority !== DEFAULT_SETTINGS.priority
    || value.freeEnabled !== DEFAULT_SETTINGS.freeEnabled
    || value.dictPairs.length > 0
    || whitelist !== defaultWhitelist;
}

const OWNER_KEY = 'wc:translation-owner';
let syncInFlight: Promise<void> | null = null;

async function currentUserId(): Promise<string> {
  try {
    return (await api<{ id: string }>('/api/me')).id;
  } catch {
    return '';
  }
}

/**
 * Pull the account-level translation configuration once per session, then keep
 * localStorage as the fast path used by the camera's manual translate button.
 * On first run after this feature ships, an existing browser config is uploaded
 * only for the account that created it; another account gets clean defaults.
 */
export function syncTranslationSettings(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const userId = await currentUserId();
    const remote = await api<RemoteTranslationSettings>('/api/translation-settings');
    if (remote.configured) {
      writeLocalTranslationSettings({
        priority: remote.priority,
        freeEnabled: remote.freeEnabled,
        dictPairs: remote.dictPairs,
        whitelist: remote.whitelist,
      });
      if (userId) localStorage.setItem(OWNER_KEY, userId);
      return;
    }

    const previousOwner = localStorage.getItem(OWNER_KEY);
    if (previousOwner && userId && previousOwner !== userId) {
      // Never leak the previous account's dictionary/whitelist into a new one.
      writeLocalTranslationSettings(DEFAULT_SETTINGS);
      localStorage.setItem(OWNER_KEY, userId);
      return;
    }

    const local = readLocalTranslationSettings();
    if (hasCustomSettings(local)) {
      await api('/api/translation-settings', { method: 'PUT', body: JSON.stringify(local) });
    }
    if (userId) localStorage.setItem(OWNER_KEY, userId);
  })().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export async function saveTranslationSettings(value: TranslationSettings, ownerId?: string): Promise<void> {
  writeLocalTranslationSettings(value);
  await api('/api/translation-settings', { method: 'PUT', body: JSON.stringify(value) });
  const id = ownerId || await currentUserId();
  if (id) localStorage.setItem(OWNER_KEY, id);
}
