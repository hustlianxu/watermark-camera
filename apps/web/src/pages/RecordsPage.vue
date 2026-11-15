<template>
  <div>
    <div class="card">
      <div class="row" style="justify-content: space-between">
        <div><strong>我的记录</strong><div class="hint">{{ records.length }} 条<span v-if="selected.length"> · 已选 {{ selected.length }}</span></div></div>
        <div class="row">
          <button class="btn secondary" @click="load">刷新</button>
          <button class="btn secondary" @click="toggleSelectMode">{{ selectMode ? '退出批量' : '批量选择' }}</button>
          <button class="btn secondary" :disabled="!records.length || exporting" @click="exportZip">导出 ZIP</button>
          <button class="btn" :disabled="!records.length || exporting" @click="exportXlsx">导出 Excel</button>
          <button v-if="readyExport" class="btn" @click="downloadReady">下载导出文件</button>
        </div>
      </div>
      <input v-model="q" class="input" style="margin-top:10px" placeholder="搜索货号 / 描述 / 客户 / 柜号…" @input="scheduleLoad" />
      <div class="row" style="margin-top:10px;gap:8px">
        <button class="btn secondary" :class="{ active: selectedFolder === '' }" @click="selectFolder('')">全部</button>
        <button class="btn secondary" :class="{ active: selectedFolder === 'none' }" @click="selectFolder('none')">未分类</button>
        <button v-for="f in folders" :key="f.id" class="btn secondary" :class="{ active: selectedFolder === f.id }" @click="selectFolder(f.id)">{{ f.name }}</button>
        <button class="btn secondary" @click="addFolder">+ 文件夹</button>
        <button v-if="selectedFolder && selectedFolder !== 'none'" class="btn secondary" @click="shareFolder">分享此文件夹</button>
      </div>
      <div v-if="selectMode" class="select-bar">
        <label style="display:flex;align-items:center;gap:8px;margin:0">
          <input type="checkbox" :checked="allPageSelected" style="width:18px;height:18px" @change="togglePage(($event.target as HTMLInputElement).checked)" />
          全选本页
        </label>
        <span class="hint">已选 {{ selected.length }} 条，跨页保留</span>
      </div>
      <div v-if="selected.length" class="row" style="margin-top:10px">
        <select v-model.number="shareDays" style="width:auto">
          <option :value="1">1 天</option>
          <option :value="7">7 天</option>
          <option :value="30">30 天</option>
        </select>
        <button class="btn" @click="shareSelected">分享选中</button>
        <button class="btn secondary" @click="selected = [...new Set([...selected, ...records.map(r => r.id)])]">全选本页</button>
        <button class="btn danger" @click="deleteSelected">删除选中</button>
        <button class="btn secondary" @click="selected = []">取消选择</button>
      </div>
    </div>

    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="records.length === 0" class="empty">
      没有记录<br /><br />
      <router-link class="btn" to="/">去拍第一张</router-link>
    </div>
    <div v-else>
      <div v-for="r in records" :key="r.id" class="swipe-row" @touchstart="onTouchStart($event, r.id)" @touchend="onTouchEnd($event, r.id)">
        <div class="swipe-actions">
          <button @click.stop="openRecord(r)">详情</button>
          <button @click.stop="editRecord(r)">编辑</button>
          <button @click.stop="askFolder('move', r)">移动</button>
          <button @click.stop="askFolder('copy', r)">复制</button>
          <button class="danger" @click.stop="deleteOne(r)">删除</button>
        </div>
        <div class="card record swipe-card" :class="{ swiped: swipedId === r.id }">
          <input v-if="selectMode" type="checkbox" :checked="selected.includes(r.id)" style="width:20px;height:20px" @click.stop @change="toggle(r.id, ($event.target as HTMLInputElement).checked)" />
          <router-link :to="`/records/${r.id}`" class="record" style="flex:1;min-width:0">
            <img v-if="!missing.includes(r.id)" class="thumb" :src="thumbUrl(r)" alt="" @error="markMissing(r.id)" />
            <div v-else class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:11px;color:#888">图片丢失</div>
            <div class="meta">
              <h3>{{ r.values.modelo || r.templateName || '未命名' }}</h3>
              <p>{{ r.templateName }} · {{ new Date(r.createdAt).toLocaleString() }}</p>
              <p>{{ r.width }}×{{ r.height }}</p>
            </div>
          </router-link>
        </div>
      </div>
    </div>
    <div v-if="total > pageSize" class="pager">
      <button class="btn secondary" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
      <span>第 {{ page }} / {{ Math.ceil(total / pageSize) }} 页 · 共 {{ total }} 条</span>
      <button class="btn secondary" :disabled="page >= Math.ceil(total / pageSize)" @click="goPage(page + 1)">下一页</button>
    </div>
    <div v-if="folderAction" class="sheet-backdrop" @click.self="folderAction = null">
      <div class="sheet">
        <div class="sheet-head">
          <strong>{{ folderAction.mode === 'move' ? '移动到文件夹' : '复制到文件夹' }}</strong>
          <button class="btn secondary" style="padding:6px 12px" @click="folderAction = null">取消</button>
        </div>
        <div class="sheet-body">
          <button class="btn secondary" style="width:100%;margin-bottom:8px" @click="chooseFolder('')">未分类</button>
          <button v-for="f in folders" :key="f.id" class="btn secondary" style="width:100%;margin-bottom:8px" @click="chooseFolder(f.id)">{{ f.name }}</button>
        </div>
      </div>
    </div>
    <div v-if="error || toast" class="toast">{{ error || toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type FolderItem, type RecordItem } from '../api';

const router = useRouter();
const records = ref<RecordItem[]>([]);
const swipedId = ref('');
const selectMode = ref(false);
const folderAction = ref<{ mode: 'move' | 'copy'; id: string } | null>(null);
let touchStartX = 0;
let touchStartY = 0;
const folders = ref<FolderItem[]>([]);
const selected = ref<string[]>([]);
const page = ref(1);
const pageSize = 24;
const total = ref(0);
const selectedFolder = ref('');
const q = ref('');
const loading = ref(true);
const error = ref('');
const toast = ref('');
const missing = ref<string[]>([]);
const exporting = ref(false);
const exportJob = ref<{ id: string; type: string; filename: string } | null>(null);
const readyExport = ref<{ url: string; filename: string; blob?: Blob } | null>(null);
let exportTimer: ReturnType<typeof setTimeout> | undefined;
const shareDays = ref(7);
let timer: ReturnType<typeof setTimeout> | undefined;

async function loadFolders() {
  const res = await api<{ folders: FolderItem[] }>('/api/folders');
  folders.value = res.folders;
}

async function load() {
  loading.value = true; error.value = '';
  try {
    const params = new URLSearchParams();
    if (selectedFolder.value) params.set('folderId', selectedFolder.value);
    if (q.value.trim()) params.set('q', q.value.trim());
    params.set('page', String(page.value));
    params.set('pageSize', String(pageSize));
    const res = await api<{ records: RecordItem[]; total: number }>(`/api/records?${params.toString()}`);
    records.value = res.records;
    total.value = res.total;
    const pages = Math.max(1, Math.ceil(res.total / pageSize));
    if (page.value > pages) { page.value = pages; if (res.records.length === 0 && pages > 1) await load(); }
  } catch (e: any) {
    error.value = e.message || '加载失败';
  } finally { loading.value = false; }
}

function thumbUrl(r: RecordItem) { return `/api/files/thumb/${r.id}?v=${r.updatedAt || r.createdAt}`; }

function markMissing(id: string) {
  if (!missing.value.includes(id)) missing.value = [...missing.value, id];
}
function onTouchStart(e: TouchEvent, _id: string) {
  const t = e.touches[0];
  if (!t) return;
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}
function onTouchEnd(e: TouchEvent, id: string) {
  const t = e.changedTouches[0];
  if (!t) return;
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 45) {
    swipedId.value = dx < 0 ? id : '';
  }
}
function askFolder(mode: 'move' | 'copy', r: RecordItem) {
  folderAction.value = { mode, id: r.id };
}

async function chooseFolder(folderId: string) {
  if (!folderAction.value) return;
  const { mode, id } = folderAction.value;
  try {
    if (mode === 'move') {
      await api(`/api/records/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ folderId: folderId || null }),
      });
    } else {
      await api(`/api/records/${id}/copy`, {
        method: 'POST',
        body: JSON.stringify({ folderId: folderId || undefined }),
      });
    }
    folderAction.value = null;
    swipedId.value = '';
    toast.value = mode === 'move' ? '已移动' : '已复制';
    await load();
  } catch (e: any) {
    error.value = (mode === 'move' ? '移动失败：' : '复制失败：') + (e.message || '未知');
  }
}

function openRecord(r: RecordItem) { swipedId.value = ''; router.push(`/records/${r.id}`); }
function editRecord(r: RecordItem) { swipedId.value = ''; router.push(`/records/${r.id}?edit=1`); }
async function deleteOne(r: RecordItem) {
  if (!confirm('确定删除这条记录？')) return;
  await api(`/api/records/${r.id}`, { method: 'DELETE' });
  swipedId.value = '';
  await load();
}
function scheduleLoad() {
  page.value = 1;
  selected.value = [];
  if (timer) clearTimeout(timer);
  timer = setTimeout(load, 300);
}
function selectFolder(id: string) { selectedFolder.value = id; page.value = 1; selected.value = []; load(); }
const allPageSelected = computed(() => records.value.length > 0 && records.value.every((r) => selected.value.includes(r.id)));
function togglePage(on: boolean) {
  if (on) selected.value = [...new Set([...selected.value, ...records.value.map((r) => r.id)])];
  else selected.value = selected.value.filter((id) => !records.value.some((r) => r.id === id));
}
function goPage(n: number) { page.value = n; void load(); }

function toggleSelectMode() {
  selectMode.value = !selectMode.value;
  if (!selectMode.value) selected.value = [];
}

function toggle(id: string, on: boolean) {
  selected.value = on ? [...new Set([...selected.value, id])] : selected.value.filter((x) => x !== id);
}
async function addFolder() {
  const name = prompt('文件夹名称（如：客户A / 2026-11 装柜）');
  if (!name?.trim()) return;
  try {
    await api('/api/folders', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    await loadFolders();
  } catch (e: any) { error.value = e.message || '创建失败'; }
}

function selectedIds() { return selected.value.length ? selected.value : records.value.map((r) => r.id); }

async function downloadFile(url: string, filename: string) {
  if (exporting.value) return;
  exporting.value = true;
  toast.value = '正在生成文件…';
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 20000);
  } catch (e: any) {
    error.value = '导出失败：' + (e.message || '未知');
  } finally {
    exporting.value = false;
    setTimeout(() => { toast.value = ''; }, 2500);
  }
}
async function prefetchExport() {
  if (!readyExport.value) return;
  try {
    const res = await fetch(readyExport.value.url, { credentials: 'same-origin' });
    if (res.ok && readyExport.value) readyExport.value.blob = await res.blob();
  } catch {}
}

async function downloadReady() {
  if (!readyExport.value) return;
  const { url, filename, blob } = readyExport.value;
  if (blob) {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        readyExport.value = null;
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
      }
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 20000);
    readyExport.value = null;
    return;
  }
  window.open(url, '_blank', 'noopener');
}

async function startExport(type: 'zip' | 'xlsx') {
  if (!records.value.length || exporting.value) return;
  exporting.value = true;
  toast.value = '后台生成中，可切到其他应用，完成后回来下载';
  try {
    const res = await api<{ id: string }>('/api/exports', {
      method: 'POST',
      body: JSON.stringify({ type, ids: selectedIds() }),
    });
    const filename = `watermark-${Date.now()}.${type}`;
    exportJob.value = { id: res.id, type, filename };
    localStorage.setItem('wc:export-job', JSON.stringify(exportJob.value));
    void pollExport();
  } catch (e: any) {
    exporting.value = false;
    error.value = '导出失败：' + (e.message || '未知');
  }
}

async function pollExport() {
  if (!exportJob.value) return;
  try {
    const r = await api<{ status: string; error?: string }>(`/api/exports/${exportJob.value.id}`);
    if (r.status === 'ready') {
      const job = exportJob.value;
      exportJob.value = null;
      localStorage.removeItem('wc:export-job');
      exporting.value = false;
      readyExport.value = { url: `/api/exports/${job.id}/file`, filename: job.filename };
      toast.value = '导出完成，点“下载导出文件”';
      void prefetchExport();
      return;
    }
    if (r.status === 'failed') {
      exporting.value = false;
      error.value = '导出失败：' + (r.error || '未知');
      exportJob.value = null;
      localStorage.removeItem('wc:export-job');
      return;
    }
    exportTimer = setTimeout(pollExport, 2000);
  } catch {
    // 页面切后台/网络抖动时稍后继续；服务端任务不会中断
    exportTimer = setTimeout(pollExport, 3000);
  }
}

function resumeExport() {
  try {
    const raw = localStorage.getItem('wc:export-job');
    if (!raw) return;
    exportJob.value = JSON.parse(raw);
    exporting.value = true;
    toast.value = '正在恢复后台导出任务…';
    void pollExport();
  } catch { localStorage.removeItem('wc:export-job'); }
}

function exportZip() { void startExport('zip'); }
function exportXlsx() { void startExport('xlsx'); }
async function shareSelected() {
  try {
    const res = await api<{ url: string }>('/api/share', {
      method: 'POST',
      body: JSON.stringify({ recordIds: selected.value, days: shareDays.value }),
    });
    const url = location.origin + res.url;
    try { await navigator.clipboard.writeText(url); } catch { prompt('复制分享链接', url); }
    toast.value = '分享链接已复制';
    setTimeout(() => { toast.value = ''; }, 2500);
  } catch (e: any) { error.value = e.message || '分享失败'; }
}
async function shareFolder() {
  if (!selectedFolder.value || selectedFolder.value === 'none') return;
  try {
    const res = await api<{ url: string }>('/api/share', {
      method: 'POST',
      body: JSON.stringify({ folderId: selectedFolder.value, days: shareDays.value }),
    });
    const url = location.origin + res.url;
    try { await navigator.clipboard.writeText(url); } catch { prompt('复制分享链接', url); }
    toast.value = '文件夹分享链接已复制';
    setTimeout(() => { toast.value = ''; }, 2500);
  } catch (e: any) { error.value = e.message || '分享失败'; }
}

async function deleteSelected() {
  if (!selected.value.length || !confirm(`确定删除选中的 ${selected.value.length} 条？`)) return;
  for (const id of selected.value) {
    await api(`/api/records/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  selected.value = [];
  await load();
}
onMounted(async () => {
  await Promise.all([loadFolders(), load()]);
  resumeExport();
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && exportJob.value) void pollExport(); });
});
onBeforeUnmount(() => { if (exportTimer) clearTimeout(exportTimer); });
</script>
