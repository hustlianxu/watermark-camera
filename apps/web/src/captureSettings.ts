import { api } from './api';

export interface CaptureSettings {
  saveLocal: boolean;
  syncRemote: boolean;
  excelExportRequired?: boolean;
}

const STORAGE_KEY = 'wc:capture-settings';
const OWNER_KEY = 'wc:capture-owner';

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  saveLocal: true,
  syncRemote: true,
  excelExportRequired: false,
};

export function readLocalCaptureSettings(): CaptureSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CAPTURE_SETTINGS };
    const value = JSON.parse(raw) as Partial<CaptureSettings>;
    return {
      saveLocal: value.saveLocal !== false,
      syncRemote: value.syncRemote !== false,
      excelExportRequired: value.excelExportRequired === true,
    };
  } catch {
    return { ...DEFAULT_CAPTURE_SETTINGS };
  }
}

export function writeLocalCaptureSettings(value: CaptureSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

async function currentUserId(): Promise<string> {
  try {
    return (await api<{ id: string }>('/api/me')).id;
  } catch {
    return '';
  }
}

export async function syncCaptureSettings(): Promise<CaptureSettings> {
  const userId = await currentUserId();
  const previousOwner = localStorage.getItem(OWNER_KEY);
  if (previousOwner && userId && previousOwner !== userId) {
    writeLocalCaptureSettings(DEFAULT_CAPTURE_SETTINGS);
    localStorage.setItem(OWNER_KEY, userId);
    return { ...DEFAULT_CAPTURE_SETTINGS };
  }
  const remote = await api<CaptureSettings>('/api/capture-settings');
  const excelExportRequired = remote.excelExportRequired === true;
  const value: CaptureSettings = {
    saveLocal: remote.saveLocal !== false,
    syncRemote: excelExportRequired ? true : remote.syncRemote !== false,
    excelExportRequired,
  };
  writeLocalCaptureSettings(value);
  if (userId) localStorage.setItem(OWNER_KEY, userId);
  return value;
}

export async function saveCaptureSettings(value: CaptureSettings, ownerId?: string): Promise<CaptureSettings> {
  const saved = await api<CaptureSettings>('/api/capture-settings', {
    method: 'PUT',
    body: JSON.stringify({
      saveLocal: value.saveLocal,
      syncRemote: value.syncRemote,
    }),
  });
  const excelExportRequired = saved.excelExportRequired === true;
  const result: CaptureSettings = {
    saveLocal: saved.saveLocal !== false,
    syncRemote: excelExportRequired ? true : saved.syncRemote !== false,
    excelExportRequired,
  };
  writeLocalCaptureSettings(result);
  const id = ownerId || await currentUserId();
  if (id) localStorage.setItem(OWNER_KEY, id);
  return result;
}
