<template>
  <div v-if="record">
    <div class="card">
      <div v-if="editing" class="edit-stage">
        <canvas ref="editCanvas" @pointerdown="onEditDown" @pointermove="onEditMove" @pointerup="onEditUp" @pointercancel="onEditUp"></canvas>
      </div>
      <img v-else-if="!imageMissing" class="detail-img" :src="record.imageUrl" alt="水印照片" @error="imageMissing = true" />
      <div v-else class="card" style="text-align:center;color:#888;padding:40px 0">图片文件丢失（旧版本存储 bug）<br />请删除后重拍</div>

      <div v-if="editing" class="row" style="margin-top:10px">
        <button class="btn" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存并重渲' }}</button>
        <button class="btn secondary" @click="cancelEdit">取消编辑</button>
      </div>

      <template v-else>
        <div class="row" style="margin-top:10px">
          <button class="btn secondary" @click="startEdit">编辑水印</button>
          <button class="btn secondary" @click="stripWatermark">生成无水印图</button>
        </div>

        <div class="share-box">
          <label>分享链接有效期</label>
          <select v-model.number="shareDays" style="width:auto">
            <option :value="1">1 天</option>
            <option :value="7">7 天</option>
            <option :value="30">30 天</option>
          </select>
          <button class="btn" @click="share">生成分享链接</button>
        </div>

        <div class="row" style="margin-top:10px">
          <a class="btn secondary" :href="record.imageUrl" download>下载水印图</a>
          <button class="btn danger" @click="remove">删除记录</button>
        </div>
      </template>

      <div v-if="editing && editField" class="inline-editor" :style="editInlineStyle">
        <div class="inline-head">
          <span>{{ editField.label }}</span>
          <button class="dock-mini" @click="editField = null">完成</button>
        </div>
        <textarea v-if="editField.type === 'textarea' || editField.multiline" v-model="draft[editField.key]" class="dock-input" rows="2" autofocus @input="drawEditor" />
        <input v-else v-model="draft[editField.key]" class="dock-input" autofocus @input="drawEditor" />
      </div>

      <p class="hint">{{ editing ? '点图片里的水印文字编辑；拖动移动；双指缩放。' : '分享链接只读；客户微信内可看图/长按保存。' }}</p>
    </div>

    <div class="card">
      <strong>照片信息</strong>
      <div class="row" style="margin-top:10px;gap:8px">
        <label style="margin:0">文件夹</label>
        <select v-model="moveTo" class="input" style="flex:1" @change="moveFolder">
          <option value="">未分类</option>
          <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
      </div>
      <p class="hint">选择后立即移动，不会重新加水印。</p>
      <div class="meta-grid">
        <div><span>模板</span><b>{{ record.templateName }}</b></div>
        <div><span>尺寸</span><b>{{ record.width }}×{{ record.height }}</b></div>
        <div><span>时间</span><b>{{ new Date(record.createdAt).toLocaleString() }}</b></div>
      </div>
      <div class="fields" style="margin-top:12px">
        <div v-for="f in fields" :key="f.key" v-show="record.values[f.key]">
          <div class="k">{{ f.label }}</div>
          <div>{{ record.values[f.key] }}</div>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
  <div v-else class="empty">加载中…</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type FolderItem, type RecordItem } from '../api';
import { drawWatermark, makeSpec, type Position, type WatermarkTemplate, type TemplateField } from '@wc/core';

const route = useRoute();
const router = useRouter();
const record = ref<RecordItem | null>(null);
const draft = ref<Record<string, string>>({});
const editing = ref(false);
const saving = ref(false);
const shareDays = ref(7);
const imageMissing = ref(false);
const toast = ref('');
const fields = computed(() => record.value?.template?.fields ?? []);
const folders = ref<FolderItem[]>([]);
const moveTo = ref('');
const editCanvas = ref<HTMLCanvasElement | null>(null);
const editField = ref<TemplateField | null>(null);
const editInlineStyle = ref<Record<string, string>>({});
const editX = ref<number | null>(null);
const editY = ref<number | null>(null);
const editScale = ref(1);
const editHeightScale = ref(1);
const editOpacity = ref(0.85);
const editWidth = ref(0.42);
const editPosition = ref<Position>('bottom-center');
let editImage: HTMLImageElement | null = null;
let editLines: { key: string; x: number; y: number; w: number; h: number }[] = [];
let editLayout: { x: number; y: number; width: number; height: number; fontSize: number } | null = null;
let editHandles: { right: { x: number; y: number }; bottom: { x: number; y: number }; corner: { x: number; y: number } } | null = null;
let editResize: { mode: 'right' | 'bottom' | 'corner'; clientX: number; clientY: number; width: number; heightScale: number } | null = null;
let editPointers = new Map<number, { x: number; y: number }>();
let editPinch: { dist: number; scale: number } | null = null;
let editPress: { x: number; y: number; baseX: number; baseY: number; key?: string; moved: boolean } | null = null;

async function load() {
  const [r, f] = await Promise.all([
    api<RecordItem>(`/api/records/${route.params.id}`),
    api<{ folders: FolderItem[] }>('/api/folders'),
  ]);
  record.value = r;
  draft.value = { ...r.values };
  folders.value = f.folders;
  moveTo.value = r.folderId ?? '';
  if (route.query.edit === '1') {
    editing.value = true;
    nextTick(initEditor);
  }
}

async function initEditor() {
  if (!record.value) return;
  const url = record.value.originalUrl;
  if (!url) { toast.value = '原图丢失，无法进入编辑器'; editing.value = false; return; }
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { await new Promise((res) => { img.onload = res; img.onerror = res; }); }
  if (!img.naturalWidth) { toast.value = '原图加载失败'; editing.value = false; return; }
  editImage = img;
  const spec = (record.value.spec ?? {}) as any;
  editPosition.value = spec.position ?? 'bottom-center';
  editScale.value = spec.scale ?? 1;
  editHeightScale.value = spec.heightScale ?? 1;
  editOpacity.value = spec.opacity ?? 0.85;
  editWidth.value = spec.widthRatio ?? 0.42;
  editX.value = spec.x ?? null;
  editY.value = spec.y ?? null;
  draft.value = { ...record.value.values };
  nextTick(drawEditor);
}

function drawEditor() {
  const c = editCanvas.value;
  if (!c || !editImage || !record.value?.template) return;
  const maxW = 1100;
  const sc = Math.min(1, maxW / editImage.naturalWidth);
  const w = Math.max(1, Math.round(editImage.naturalWidth * sc));
  const h = Math.max(1, Math.round(editImage.naturalHeight * sc));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(editImage, 0, 0, w, h);
  const preview: Record<string, string> = { ...draft.value };
  for (const f of record.value.template.fields) {
    if (!String(preview[f.key] ?? '').trim()) preview[f.key] = '—';
  }
  const spec = makeSpec({
    templateId: record.value.templateId,
    values: preview,
    position: editPosition.value,
    x: editX.value, y: editY.value,
    scale: editScale.value, heightScale: editHeightScale.value, opacity: editOpacity.value, widthRatio: editWidth.value,
  });
  const layout = drawWatermark(ctx as any, record.value.template as unknown as WatermarkTemplate, spec, w, h);
  editLayout = layout ? { x: layout.x, y: layout.y, width: layout.width, height: layout.height, fontSize: layout.fontSize } : null;
  editHandles = null;
  editLines = [];
  if (layout) {
    const indent = Math.round(layout.fontSize * 1.4);
    layout.lines.forEach((line, i) => {
      if (!line.fieldKey) return;
      editLines.push({
        key: line.fieldKey,
        x: layout.x + layout.padding + ((!line.isLabel && !line.isInline) ? indent : 0),
        y: layout.y + layout.padding + i * layout.lineHeight,
        w: layout.width - layout.padding * 2,
        h: layout.lineHeight,
      });
    });
    const hs = Math.max(12, Math.round(layout.fontSize * 0.9));
    editHandles = {
      right: { x: layout.x + layout.width, y: layout.y + layout.height / 2 },
      bottom: { x: layout.x + layout.width / 2, y: layout.y + layout.height },
      corner: { x: layout.x + layout.width, y: layout.y + layout.height },
    };
    ctx.save();
    ctx.fillStyle = '#14b8a6';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, hs * 0.18);
    for (const h of Object.values(editHandles)) {
      ctx.beginPath(); ctx.arc(h.x, h.y, hs / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
}

function editHitHandle(clientX: number, clientY: number): 'right' | 'bottom' | 'corner' | null {
  const c = editCanvas.value;
  if (!c || !editHandles) return null;
  const rect = c.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width * c.width;
  const y = (clientY - rect.top) / rect.height * c.height;
  const tol = Math.max(20, editLayout?.fontSize ?? 20);
  for (const mode of ['corner', 'right', 'bottom'] as const) {
    const h = editHandles[mode];
    if (Math.hypot(x - h.x, y - h.y) <= tol) return mode;
  }
  return null;
}

function editHit(clientX: number, clientY: number) {
  const c = editCanvas.value;
  if (!c) return null;
  const rect = c.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width * c.width;
  const y = (clientY - rect.top) / rect.height * c.height;
  return editLines.find((l) => x >= l.x - 6 && x <= l.x + l.w + 6 && y >= l.y - 2 && y <= l.y + l.h + 2) ?? null;
}

function openEditField(key: string, line: typeof editLines[number]) {
  const f = record.value?.template?.fields.find((x) => x.key === key);
  const c = editCanvas.value;
  if (!f || !c) return;
  const rect = c.getBoundingClientRect();
  const sx = rect.width / c.width;
  const sy = rect.height / c.height;
  const width = Math.min(360, Math.max(220, line.w * sx));
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + line.x * sx));
  const top = Math.max(70, Math.min(window.innerHeight - 180, rect.top + line.y * sy - 40));
  editInlineStyle.value = { left: `${left}px`, top: `${top}px`, width: `${width}px` };
  editField.value = f;
}

function onEditDown(e: PointerEvent) {
  if (!editCanvas.value) return;
  editPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (editPointers.size === 2) {
    const [a, b] = [...editPointers.values()];
    editPinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: editScale.value };
    editPress = null;
    editResize = null;
    return;
  }
  if (!editLayout) return;
  const handle = editHitHandle(e.clientX, e.clientY);
  if (handle) {
    editResize = { mode: handle, clientX: e.clientX, clientY: e.clientY, width: editWidth.value, heightScale: editHeightScale.value };
    editPress = null;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    return;
  }
  const rect = editCanvas.value.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width * editCanvas.value.width;
  const py = (e.clientY - rect.top) / rect.height * editCanvas.value.height;
  if (px < editLayout.x || py < editLayout.y || px > editLayout.x + editLayout.width || py > editLayout.y + editLayout.height) return;
  const hit = editHit(e.clientX, e.clientY);
  editPress = { x: e.clientX, y: e.clientY, baseX: editLayout.x, baseY: editLayout.y, key: hit?.key, moved: false };
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onEditMove(e: PointerEvent) {
  if (editPointers.has(e.pointerId)) editPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (editPointers.size >= 2 && editPinch) {
    const [a, b] = [...editPointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    editScale.value = Math.min(2, Math.max(0.5, Math.round((editPinch.scale * d / Math.max(1, editPinch.dist)) * 100) / 100));
    drawEditor();
    return;
  }
  if (editResize && editCanvas.value) {
    const dx = e.clientX - editResize.clientX;
    const dy = e.clientY - editResize.clientY;
    if (editResize.mode === 'right' || editResize.mode === 'corner') {
      editWidth.value = Math.min(0.9, Math.max(0.25, editResize.width + dx / editCanvas.value.width));
    }
    if (editResize.mode === 'bottom' || editResize.mode === 'corner') {
      editHeightScale.value = Math.min(2.5, Math.max(0.5, Math.round((editResize.heightScale + dy / 240) * 100) / 100));
    }
    drawEditor();
    return;
  }
  if (!editPress || !editCanvas.value) return;
  const dx = e.clientX - editPress.x;
  const dy = e.clientY - editPress.y;
  if (!editPress.moved && Math.hypot(dx, dy) < 6) return;
  if (!editPress.moved) { editPress.moved = true; editX.value = editPress.baseX; editY.value = editPress.baseY; }
  const rect = editCanvas.value.getBoundingClientRect();
  editX.value = editPress.baseX + dx / rect.width * editCanvas.value.width;
  editY.value = editPress.baseY + dy / rect.height * editCanvas.value.height;
  drawEditor();
}

function onEditUp(e: PointerEvent) {
  editPointers.delete(e.pointerId);
  if (editPointers.size < 2) editPinch = null;
  editResize = null;
  if (editPointers.size > 0) return;
  if (editPress && !editPress.moved && editPress.key) {
    const hit = editHit(e.clientX, e.clientY);
    if (hit) openEditField(hit.key, hit);
  }
  editPress = null;
}

function startEdit() {
  editing.value = true;
  nextTick(initEditor);
}

function cancelEdit() {
  editing.value = false;
  editField.value = null;
}

async function stripWatermark() {
  if (!confirm('生成无水印版本？原图仍保留，可继续编辑水印。')) return;
  try {
    const updated = await api<RecordItem>(`/api/records/${record.value!.id}/remove-watermark`, { method: 'POST' });
    record.value = { ...record.value!, ...updated };
    toast.value = '已生成无水印图';
  } catch (e: any) {
    toast.value = '去除失败：' + (e.message || '未知');
  }
  setTimeout(() => { toast.value = ''; }, 2500);
}

async function moveFolder() {
  try {
    const updated = await api<RecordItem>(`/api/records/${route.params.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ folderId: moveTo.value || null }),
    });
    record.value = { ...record.value!, ...updated };
    toast.value = '已移动';
  } catch (e: any) {
    toast.value = '移动失败：' + (e.message || '未知');
  }
  setTimeout(() => { toast.value = ''; }, 2000);
}
async function save() {
  saving.value = true;
  try {
    const updated = await api<RecordItem>(`/api/records/${route.params.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        values: draft.value,
        spec: {
          position: editPosition.value, x: editX.value, y: editY.value,
          scale: editScale.value, heightScale: editHeightScale.value, opacity: editOpacity.value, widthRatio: editWidth.value,
        },
      }),
    });
    record.value = { ...record.value!, ...updated };
    draft.value = { ...record.value.values };
    editing.value = false;
    editField.value = null;
    toast.value = '已重渲';
  } catch (e: any) {
    toast.value = '保存失败：' + (e.message || '未知');
  } finally {
    saving.value = false;
    setTimeout(() => { toast.value = ''; }, 2500);
  }
}
async function share() {
  const res = await api<{ url: string }>('/api/share', {
    method: 'POST', body: JSON.stringify({ recordId: record.value!.id, days: shareDays.value }),
  });
  const url = location.origin + res.url;
  try { await navigator.clipboard.writeText(url); toast.value = '链接已复制'; }
  catch { prompt('复制分享链接', url); }
  setTimeout(() => { toast.value = ''; }, 2500);
}
async function remove() {
  if (!confirm('确定删除这条记录？删除后不可恢复。')) return;
  try {
    await api(`/api/records/${record.value!.id}`, { method: 'DELETE' });
    window.location.assign('/records');
  } catch (e: any) {
    toast.value = '删除失败：' + (e.message || '未知');
    setTimeout(() => { toast.value = ''; }, 3000);
  }
}
onMounted(load);
</script>
