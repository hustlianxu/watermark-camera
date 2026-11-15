export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body != null && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data as T;
}

export interface TemplateField {
  key: string; label: string; type: string; multiline?: boolean; placeholder?: string; options?: string[];
}
export interface Template {
  id: string; name: string; description?: string; position: string; widthRatio: number;
  style: { fontSize: number; color: string; background: string; padding: number; borderRadius: number; lineHeight: number };
  fields: TemplateField[];
}
export interface FolderItem { id: string; name: string; createdAt: number; }
export interface RecordItem {
  id: string; folderId?: string; templateId: string; templateName: string; values: Record<string,string>;
  width: number; height: number; createdAt: number; imageUrl: string; originalUrl?: string;
  template?: Template; spec?: Record<string, unknown>;
}
