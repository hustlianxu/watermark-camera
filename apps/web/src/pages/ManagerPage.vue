<template>
  <div class="manager">
    <div class="manager-head">
      <div>
        <h1>{{ me?.role === 'admin' ? '管理后台' : '我的工作台' }}</h1>
        <p class="hint">照片、文件夹、导出与分享链接统一管理。</p>
      </div>
      <router-link class="btn secondary" to="/">返回相机</router-link>
    </div>

    <div class="stats">
      <div><b>{{ records.length }}</b><span>照片</span></div>
      <div><b>{{ folders.length }}</b><span>文件夹</span></div>
      <div><b>{{ exports.length }}</b><span>导出记录</span></div>
      <div><b>{{ shares.length }}</b><span>有效分享</span></div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <strong>照片</strong>
        <div class="row">
          <select v-model="folder" class="input" style="width:auto" @change="loadRecords">
            <option value="">全部文件夹</option>
            <option value="none">未分类</option>
            <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
          <button class="btn secondary" @click="selectAll">全选/取消</button>
          <button class="btn secondary" :disabled="exporting" @click="startExport('xlsx')">导出 Excel</button>
          <button class="btn secondary" :disabled="exporting" @click="startExport('zip')">导出 ZIP</button>
          <button v-if="selected.length" class="btn danger" @click="deleteSelected">删除选中</button>
        </div>
      </div>
      <div class="manager-table">
        <div class="manager-tr manager-th">
          <span></span><span>照片</span><span>货号 / 模板</span><span>文件夹</span><span>时间</span><span>操作</span>
        </div>
        <div v-for="r in records" :key="r.id" class="manager-tr">
          <input type="checkbox" :checked="selected.includes(r.id)" @change="toggle(r.id, ($event.target as HTMLInputElement).checked)" />
          <img :src="thumbUrl(r)" alt="" />
          <div><b>{{ r.values.modelo || '未命名' }}</b><div class="hint">{{ r.templateName }} · {{ r.width }}×{{ r.height }}</div></div>
          <div>{{ folderName(r.folderId) }}</div>
          <div class="hint">{{ new Date(r.createdAt).toLocaleString() }}</div>
          <div class="row"><router-link :to="`/records/${r.id}`">详情</router-link><router-link :to="`/records/${r.id}?edit=1`">编辑</router-link></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <strong>文件夹</strong>
        <div class="row">
          <select v-model.number="shareDays" class="input" style="width:auto">
            <option :value="1">1 天</option><option :value="7">7 天</option><option :value="30">30 天</option>
          </select>
          <button class="btn secondary" :disabled="!folder || folder === 'none'" @click="shareFolder">分享当前文件夹</button>
        </div>
      </div>
      <div class="folder-grid">
        <div v-for="f in folders" :key="f.id" class="folder-tile">
          <b>{{ f.name }}</b>
          <span class="hint">{{ countFolder(f.id) }} 张</span>
          <div class="row"><button class="btn secondary" @click="folder = f.id; loadRecords()">查看</button><button class="btn secondary" @click="exportFolder(f.id)">导出</button><button class="btn secondary" @click="shareOneFolder(f.id)">分享</button></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <strong>导出历史</strong>
        <label v-if="me?.role === 'admin'" class="row">有效期（天）<input v-model.number="ttlDays" type="number" min="1" max="90" class="input" style="width:80px" @change="saveTtl" /></label>
        <span v-else class="hint">导出有效期由管理员设置</span>
      </div>
      <div v-if="!exports.length" class="hint">暂无导出记录</div>
      <div v-for="e in exports" :key="e.id" class="export-row">
        <div><b>{{ e.type.toUpperCase() }}</b> · {{ e.count }} 张 <span class="hint">· {{ new Date(e.createdAt).toLocaleString() }}</span></div>
        <div class="hint">
          状态：{{ e.status }} · 到期：{{ new Date(e.expiresAt).toLocaleString() }}<span v-if="e.error"> · {{ e.error }}</span>
          <span v-if="e.translation"> · 已翻译 {{ e.translation.translated }} 条<span v-if="e.translation.failed">，{{ e.translation.failed }} 条失败</span></span>
        </div>
        <div class="row">
          <button v-if="e.status === 'ready'" class="btn secondary" @click="downloadExport(e.id)">下载</button>
          <button class="btn danger" @click="deleteExport(e.id)">删除</button>
        </div>
      </div>
    </div>

    <div class="card">
      <strong>分享链接</strong>
      <div v-if="!shares.length" class="hint">暂无有效分享</div>
      <div v-for="s in shares" :key="s.token" class="export-row">
        <div><b>{{ s.folderName || '照片分享' }}</b> · {{ s.count }} 张 <span class="hint">· 到期 {{ new Date(s.expiresAt).toLocaleString() }}</span></div>
        <div class="row"><a :href="s.url" target="_blank">{{ location.origin + s.url }}</a><button class="btn danger" @click="revoke(s.token)">撤回</button></div>
      </div>
    </div>
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type FolderItem, type RecordItem } from '../api';

const records = ref<RecordItem[]>([]);
const folders = ref<FolderItem[]>([]);
const exports = ref<any[]>([]);
const shares = ref<any[]>([]);
const selected = ref<string[]>([]);
const folder = ref('');
const shareDays = ref(7);
const ttlDays = ref(7);
const exporting = ref(false);
const toast = ref('');
const location = window.location;
const me = ref<{ id: string; username: string; role: string } | null>(null);

function thumbUrl(r: RecordItem) { return `/api/files/thumb/${r.id}?v=${r.updatedAt || r.createdAt}`; }
function folderName(id?: string) { return id ? folders.value.find((f) => f.id === id)?.name || '已删除文件夹' : '未分类'; }
function countFolder(id: string) { return records.value.filter((r) => r.folderId === id).length; }
function showToast(s: string) { toast.value = s; setTimeout(() => { toast.value = ''; }, 2500); }
async function loadFolders() { folders.value = (await api<{ folders: FolderItem[] }>('/api/folders')).folders; }
async function loadRecords() {
  const p = new URLSearchParams();
  if (folder.value) p.set('folderId', folder.value);
  records.value = (await api<{ records: RecordItem[] }>(`/api/records?${p}&pageSize=100`)).records;
  selected.value = selected.value.filter((id) => records.value.some((r) => r.id === id));
}
async function loadExports() { exports.value = (await api<{ exports: any[] }>('/api/exports')).exports; }
async function loadShares() { shares.value = (await api<{ shares: any[] }>('/api/shares')).shares; }
async function loadSettings() { ttlDays.value = (await api<{ exportTtlDays: number }>('/api/settings')).exportTtlDays; }
function toggle(id: string, on: boolean) { selected.value = on ? [...selected.value, id] : selected.value.filter((x) => x !== id); }
function selectAll() { selected.value = selected.value.length ? [] : records.value.map((r) => r.id); }
async function startExport(type: 'xlsx' | 'zip') {
  exporting.value = true;
  const ids = selected.value.length ? selected.value : records.value.map((r) => r.id);
  try {
    const r = await api<{ id: string }>('/api/exports', { method: 'POST', body: JSON.stringify({ type, ids }) });
    showToast('后台生成中…');
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      const e = exports.value.find((x) => x.id === r.id) || (await api<any>(`/api/exports/${r.id}`));
      if (e.status === 'ready' || e.status === 'failed') break;
    }
    await loadExports();
  } catch (e: any) { showToast(e.message || '导出失败'); }
  exporting.value = false;
}
async function exportFolder(id: string) {
  folder.value = id; await loadRecords(); selected.value = records.value.map((r) => r.id); await startExport('xlsx');
}
async function shareFolder() {
  if (!folder.value || folder.value === 'none') return;
  const r = await api<{ url: string }>('/api/share', { method: 'POST', body: JSON.stringify({ folderId: folder.value, days: shareDays.value }) });
  const url = location.origin + r.url;
  try { await navigator.clipboard.writeText(url); showToast('文件夹分享链接已复制'); } catch { prompt('分享链接', url); }
  await loadShares();
}
async function shareOneFolder(id: string) {
  folder.value = id;
  await shareFolder();
}
async function downloadExport(id: string) { window.open(`/api/exports/${id}/file`, '_blank', 'noopener'); }
async function deleteExport(id: string) {
  if (!confirm('删除这条导出记录和文件？')) return;
  await api(`/api/exports/${id}`, { method: 'DELETE' });
  await loadExports();
}
async function revoke(token: string) {
  if (!confirm('撤回这个分享链接？')) return;
  await api(`/api/shares/${encodeURIComponent(token)}`, { method: 'DELETE' });
  await loadShares();
}
async function deleteSelected() {
  if (!selected.value.length || !confirm(`删除选中的 ${selected.value.length} 条记录？`)) return;
  for (const id of selected.value) await api(`/api/records/${id}`, { method: 'DELETE' });
  selected.value = [];
  await loadRecords();
}
async function saveTtl() {
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ exportTtlDays: ttlDays.value }) });
  showToast('导出有效期已保存');
}
async function loadMe() {
  try {
    const r = await api<{ id: string; user: string; role: string }>('/api/me');
    me.value = { id: r.id, username: r.user, role: r.role };
  } catch {}
}
onMounted(async () => { await Promise.all([loadMe(), loadFolders(), loadRecords(), loadExports(), loadShares(), loadSettings()]); });
</script>
