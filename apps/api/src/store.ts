import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

export interface FolderItem {
  id: string;
  name: string;
  ownerId?: string;
  createdAt: number;
}

export interface RecordItem {
  id: string;
  folderId?: string;
  ownerId?: string;
  templateId: string;
  templateName: string;
  values: Record<string, string>;
  spec: unknown;
  width: number;
  height: number;
  mime: string;
  originalKey: string;
  renderKey: string;
  createdAt: number;
  updatedAt?: number;
  capturedAt?: number;
  watermarkRemoved?: boolean;
}

export interface ShareItem {
  token: string;
  recordIds: string[];
  ownerId?: string;
  folderId?: string;
  folderName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface ExportItem {
  id: string;
  type: 'xlsx' | 'zip';
  status: 'queued' | 'running' | 'ready' | 'failed';
  ids?: string[];
  ownerId?: string;
  folderId?: string;
  count: number;
  key?: string;
  size?: number;
  error?: string;
  createdAt: number;
  expiresAt: number;
}

export interface AppSettings {
  exportTtlDays: number;
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
  createdAt: number;
}

export interface UserSettings {
  llm?: { provider: string; baseURL: string; model: string; apiKey: string };
}

interface DB {
  records: RecordItem[];
  shares: ShareItem[];
  folders: FolderItem[];
  exports: ExportItem[];
  settings: AppSettings;
  users: User[];
  userSettings: Record<string, UserSettings>;
}

const emptyDb = (): DB => ({ records: [], shares: [], folders: [], exports: [], settings: { exportTtlDays: 7 }, users: [], userSettings: {} });

export class JsonStore {
  private db: DB = emptyDb();
  private readonly file: string;
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'db.json');
    this.dataDir = dataDir;
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DB> & { settings?: any };
      this.db = {
        records: parsed.records ?? [],
        shares: parsed.shares ?? [],
        folders: parsed.folders ?? [],
        exports: parsed.exports ?? [],
        settings: { exportTtlDays: parsed.settings?.exportTtlDays ?? 7 },
        users: parsed.users ?? [],
        userSettings: parsed.userSettings ?? {},
      };
      const legacyLlm = parsed.settings?.llm;
      if (legacyLlm) {
        const admin = this.db.users.find((u) => u.role === 'admin');
        if (admin) this.db.userSettings[admin.id] = { ...(this.db.userSettings[admin.id] ?? {}), llm: legacyLlm };
      }
    } catch {
      this.db = emptyDb();
      await this.save();
    }
  }

  private async save(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(tmp, JSON.stringify(this.db, null, 2), 'utf8');
    await rename(tmp, this.file);
  }

  listRecords(ownerId?: string): RecordItem[] {
    return [...this.db.records]
      .filter((r) => !ownerId || r.ownerId === ownerId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  listFolders(ownerId?: string): FolderItem[] {
    return [...this.db.folders]
      .filter((f) => !ownerId || f.ownerId === ownerId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  getFolder(id: string): FolderItem | undefined {
    return this.db.folders.find((f) => f.id === id);
  }
  async addFolder(name: string, ownerId?: string): Promise<FolderItem> {
    if (this.db.folders.some((f) => f.name === name && f.ownerId === ownerId)) throw new Error('DUPLICATE_FOLDER');
    const f: FolderItem = { id: randomBytes(16).toString('hex'), name, ownerId, createdAt: Date.now() };
    this.db.folders.push(f);
    await this.save();
    return f;
  }
  async deleteFolder(id: string): Promise<boolean> {
    const before = this.db.folders.length;
    this.db.folders = this.db.folders.filter((f) => f.id !== id);
    if (this.db.folders.length === before) return false;
    for (const r of this.db.records) if (r.folderId === id) delete r.folderId;
    await this.save();
    return true;
  }
  getRecord(id: string): RecordItem | undefined {
    return this.db.records.find((r) => r.id === id);
  }
  async addRecord(r: RecordItem): Promise<void> {
    this.db.records.unshift(r);
    await this.save();
  }
  async updateRecord(r: RecordItem): Promise<void> {
    const i = this.db.records.findIndex((x) => x.id === r.id);
    if (i < 0) throw new Error('NOT_FOUND');
    this.db.records[i] = r;
    await this.save();
  }
  async deleteRecord(id: string): Promise<boolean> {
    const before = this.db.records.length;
    this.db.records = this.db.records.filter((r) => r.id !== id);
    if (this.db.records.length === before) return false;
    await this.save();
    return true;
  }
  async createShare(recordIds: string[], ttlMs: number, meta?: { folderId?: string; folderName?: string; ownerId?: string }): Promise<ShareItem> {
    const token = randomBytes(24).toString('base64url');
    const item: ShareItem = { token, recordIds, createdAt: Date.now(), expiresAt: Date.now() + ttlMs, ...meta };
    this.db.shares.unshift(item);
    await this.save();
    return item;
  }
  listShares(ownerId?: string): ShareItem[] {
    return this.db.shares
      .filter((s) => s.expiresAt > Date.now())
      .filter((s) => !ownerId || s.ownerId === ownerId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async revokeShare(token: string): Promise<boolean> {
    const before = this.db.shares.length;
    this.db.shares = this.db.shares.filter((s) => s.token !== token);
    if (this.db.shares.length === before) return false;
    await this.save();
    return true;
  }
  getShare(token: string): ShareItem | undefined {
    const s = this.db.shares.find((x) => x.token === token);
    if (!s || s.expiresAt < Date.now()) return undefined;
    return s;
  }

  getSettings(): AppSettings {
    return { exportTtlDays: Math.min(90, Math.max(1, this.db.settings.exportTtlDays || 7)) };
  }
  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.db.settings = { ...this.getSettings(), ...patch };
    this.db.settings.exportTtlDays = Math.min(90, Math.max(1, this.db.settings.exportTtlDays || 7));
    await this.save();
    return this.getSettings();
  }
  getUserSettings(userId: string): UserSettings {
    return this.db.userSettings[userId] ?? {};
  }
  async updateUserSettings(userId: string, patch: UserSettings): Promise<UserSettings> {
    this.db.userSettings[userId] = { ...(this.db.userSettings[userId] ?? {}), ...patch };
    await this.save();
    return this.db.userSettings[userId];
  }
  listExports(ownerId?: string): ExportItem[] {
    return [...this.db.exports]
      .filter((e) => !ownerId || e.ownerId === ownerId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  getExport(id: string): ExportItem | undefined {
    return this.db.exports.find((e) => e.id === id);
  }
  async addExport(e: ExportItem): Promise<void> {
    this.db.exports.unshift(e);
    await this.save();
  }
  async updateExport(e: ExportItem): Promise<void> {
    const i = this.db.exports.findIndex((x) => x.id === e.id);
    if (i >= 0) this.db.exports[i] = e;
    else this.db.exports.unshift(e);
    await this.save();
  }
  async deleteExport(id: string): Promise<boolean> {
    const before = this.db.exports.length;
    this.db.exports = this.db.exports.filter((e) => e.id !== id);
    if (this.db.exports.length === before) return false;
    await this.save();
    return true;
  }

  listUsers(): User[] {
    return [...this.db.users].sort((a, b) => a.createdAt - b.createdAt);
  }
  getUser(id: string): User | undefined {
    return this.db.users.find((u) => u.id === id);
  }
  getUserByUsername(username: string): User | undefined {
    return this.db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  }
  async addUser(u: User): Promise<void> {
    this.db.users.push(u);
    await this.save();
  }
  async updateUser(u: User): Promise<void> {
    const i = this.db.users.findIndex((x) => x.id === u.id);
    if (i < 0) throw new Error('NOT_FOUND');
    this.db.users[i] = u;
    await this.save();
  }
  async deleteUser(id: string): Promise<boolean> {
    const before = this.db.users.length;
    this.db.users = this.db.users.filter((u) => u.id !== id);
    if (this.db.users.length === before) return false;
    delete this.db.userSettings[id];
    await this.save();
    return true;
  }
  async migrateOwner(adminId: string): Promise<void> {
    let changed = false;
    for (const r of this.db.records) if (!r.ownerId) { r.ownerId = adminId; changed = true; }
    for (const f of this.db.folders) if (!f.ownerId) { f.ownerId = adminId; changed = true; }
    for (const s of this.db.shares) if (!s.ownerId) { s.ownerId = adminId; changed = true; }
    for (const e of this.db.exports) if (!e.ownerId) { e.ownerId = adminId; changed = true; }
    if (changed) await this.save();
  }
}
