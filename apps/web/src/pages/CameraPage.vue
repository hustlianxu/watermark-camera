<template>
  <div class="camera-page">
    <div class="camera-stage">
      <video ref="videoEl" class="camera-video" autoplay playsinline muted :style="{ transform: `scale(${zoom})` }" @loadedmetadata="onVideoMeta"></video>
      <canvas ref="overlayEl" class="overlay-canvas" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp"></canvas>

      <div class="camera-top">
        <select v-model="templateId" class="glass-select" @change="onTemplateChange">
          <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
        <select v-model="folderId" class="glass-select">
          <option value="">未分类</option>
          <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
        <span v-if="pendingCount" class="badge">待传 {{ pendingCount }}</span>
        <div class="zoom-pill">
          <button @click="setZoom(zoom - 0.5)">−</button>
          <span>{{ zoom.toFixed(1) }}×</span>
          <button @click="setZoom(zoom + 0.5)">+</button>
        </div>
      </div>

      <div v-if="cameraError" class="camera-error">
        {{ cameraError }}
        <button class="btn secondary" @click="startCamera">重试相机</button>
      </div>

      <div class="camera-controls">
        <label class="ctrl-btn" @click="saveTemplateState(); localStorage.setItem('wc:last-template', templateId)">
          相册
          <input type="file" accept="image/*" capture="environment" style="display:none" @change="onFile" />
        </label>
        <button class="shutter" :disabled="busy" @click="capture" :aria-label="busy ? '处理中' : '拍照'"></button>
        <button class="ctrl-btn" @click="styleOpen = true">样式</button>
      </div>
    </div>

    <div v-if="styleOpen" class="sheet-backdrop" @click.self="styleOpen = false">
      <div class="sheet">
        <div class="sheet-head">
          <strong>水印样式</strong>
          <button class="btn secondary" style="padding:6px 12px" @click="styleOpen = false">完成</button>
        </div>
        <div class="sheet-body">
          <div class="hint" style="margin-bottom:8px">点取景框里的水印文字可直接编辑该字段；拖动水印可移动。</div>
          <label>位置</label>
          <select v-model="position" class="input" @change="onPositionChange">
            <option value="top-left">左上</option><option value="top-center">上中</option><option value="top-right">右上</option>
            <option value="center-left">左中</option><option value="center">居中</option><option value="center-right">右中</option>
            <option value="bottom-left">左下</option><option value="bottom-center">下中</option><option value="bottom-right">右下</option>
          </select>
          <label>大小 {{ scale.toFixed(2) }}×</label>
          <input type="range" min="0.5" max="2" step="0.05" v-model.number="scale" style="width:100%" @input="redraw" />
          <label>宽度 {{ Math.round(widthRatio * 100) }}%</label>
          <input type="range" min="0.3" max="0.8" step="0.01" v-model.number="widthRatio" style="width:100%" @input="redraw" />
          <label>高度 {{ heightScale.toFixed(2) }}×</label>
          <input type="range" min="0.5" max="2.5" step="0.05" v-model.number="heightScale" style="width:100%" @input="redraw" />
          <label>背景不透明度 {{ Math.round(opacity * 100) }}%</label>
          <input type="range" min="0.4" max="1" step="0.01" v-model.number="opacity" style="width:100%" @input="redraw" />
        </div>
      </div>
    </div>

    <div v-if="activeField" class="inline-editor" :style="inlineStyle">
      <div class="inline-head">
        <span>{{ activeField.label }}</span>
        <button class="dock-mini" @click="activeField = null">完成</button>
      </div>
      <textarea v-if="activeField.type === 'textarea' || activeField.multiline" v-model="values[activeField.key]" class="dock-input" rows="2" autofocus @input="redraw" />
      <input v-else v-model="values[activeField.key]" class="dock-input" autofocus @input="redraw" />
      <div v-if="activeField.key === 'desEs' || activeField.key === 'desZh'" class="row" style="margin-top:6px">
        <button class="dock-mini" :disabled="translating" @click.prevent="translateField(activeField.key)">
          {{ translating ? '翻译中…' : (activeField.key === 'desEs' ? '中 → 西' : '西 → 中') }}
        </button>
      </div>
    </div>

    <div v-if="lastSaved" class="save-overlay" @click.self="lastSaved = null">
      <div class="save-card">
        <div class="save-ok">{{ lastSaved.uploading ? '✓ 已拍摄，上传中…' : '✓ 已保存' }}</div>
        <img :src="lastSaved.imageUrl" alt="刚保存的照片" />
        <p v-if="lastSaved.message" class="hint">{{ lastSaved.message }}</p>
        <div class="row" style="margin-top:10px">
          <button class="btn" @click="closeSaved">继续拍下一张</button>
          <button v-if="!lastSaved.uploading" class="btn secondary" @click="viewLast">查看详情</button>
        </div>
      </div>
    </div>
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { syncTranslationSettings } from '../translationConfig';
import { useRouter } from 'vue-router';
import { drawWatermark, makeSpec, type Position, type WatermarkTemplate } from '@wc/core';
import { api, type FolderItem, type Template } from '../api';
import type { TemplateField } from '../api';
import { addPending, countPending, deletePending, listPending, type PendingUpload } from '../offline';

const router = useRouter();

defineOptions({ name: 'CameraPage' });

const templates = ref<Template[]>([]);
const templateId = ref('minimal');
const folders = ref<FolderItem[]>([]);
const folderId = ref('');
const position = ref<Position>('bottom-center');
const scale = ref(1);
const heightScale = ref(1);
const opacity = ref(0.85);
const widthRatio = ref(0.42);
const customX = ref<number | null>(null);
const customY = ref<number | null>(null);
const values = ref<Record<string, string>>({});
const videoEl = ref<HTMLVideoElement | null>(null);
const overlayEl = ref<HTMLCanvasElement | null>(null);
const stream = ref<MediaStream | null>(null);
const cameraError = ref('');
const busy = ref(false);
const toast = ref('');
const pendingCount = ref(0);
const translating = ref(false);
const styleOpen = ref(false);
const activeField = ref<TemplateField | null>(null);
const inlineStyle = ref<Record<string,string>>({});
const zoom = ref(1);
const lastSaved = ref<{ id: string; imageUrl: string; uploading?: boolean; message?: string; token?: string } | null>(null);
const reuseWatermark = ref(localStorage.getItem('wc:reuse-watermark') === '1');
const pointers = new Map<number, { x: number; y: number }>();
let pinch: { dist: number; scale: number } | null = null;
let previousTemplateId = templateId.value;
let overlayLayout: { x: number; y: number; width: number; height: number; fontSize: number } | null = null;
let overlayHandles: { right: { x: number; y: number }; bottom: { x: number; y: number }; corner: { x: number; y: number } } | null = null;
let resize: { mode: 'right' | 'bottom' | 'corner'; clientX: number; clientY: number; width: number; heightScale: number } | null = null;
let hitLines: { key: string; x: number; y: number; w: number; h: number }[] = [];
let press: { clientX: number; clientY: number; baseX: number; baseY: number; key?: string; moved: boolean } | null = null;

const currentTemplate = computed(() => templates.value.find((t) => t.id === templateId.value));
const fields = computed(() => currentTemplate.value?.fields ?? []);

const TEMPLATE_PREFIX = 'wc:tpl:';
interface SavedTemplateState {
  values: Record<string, string>;
  position: Position;
  scale: number;
  heightScale: number;
  opacity: number;
  widthRatio: number;
  customX: number | null;
  customY: number | null;
}
function resetContent() {
  const v: Record<string, string> = {};
  for (const f of fields.value) {
    if (f.type === 'datetime' || f.type === 'date') v[f.key] = new Date().toISOString().slice(0, 10);
    else v[f.key] = '';
  }
  values.value = v;
  activeField.value = null;
  saveTemplateState();
  nextTick(redraw);
}

function saveTemplateState(id = templateId.value) {
  if (!id) return;
  const state: SavedTemplateState = {
    values: { ...values.value }, position: position.value, scale: scale.value, heightScale: heightScale.value,
    opacity: opacity.value, widthRatio: widthRatio.value, customX: customX.value, customY: customY.value,
  };
  try { localStorage.setItem(`${TEMPLATE_PREFIX}${id}`, JSON.stringify(state)); } catch {}
}
function readTemplateState(id: string): SavedTemplateState | null {
  try {
    const raw = localStorage.getItem(`${TEMPLATE_PREFIX}${id}`);
    return raw ? JSON.parse(raw) as SavedTemplateState : null;
  } catch { return null; }
}

function initValues() {
  const v: Record<string, string> = {};
  const saved = readTemplateState(templateId.value);
  for (const f of fields.value) {
    if (f.type === 'datetime' || f.type === 'date') v[f.key] = new Date().toISOString().slice(0, 10);
    else v[f.key] = saved?.values?.[f.key] ?? '';
  }
  values.value = v;
  if (currentTemplate.value) {
    position.value = saved?.position ?? (currentTemplate.value.position as Position);
    widthRatio.value = saved?.widthRatio ?? currentTemplate.value.widthRatio;
  }
  customX.value = saved?.customX ?? null;
  customY.value = saved?.customY ?? null;
  activeField.value = null;
  scale.value = saved?.scale ?? 1;
  heightScale.value = saved?.heightScale ?? 1;
  opacity.value = saved?.opacity ?? 0.85;
  previousTemplateId = templateId.value;
  nextTick(redraw);
}

async function loadTemplates() {
  const [res, f] = await Promise.all([
    api<{ templates: Template[] }>('/api/templates'),
    api<{ folders: FolderItem[] }>('/api/folders'),
  ]);
  templates.value = res.templates;
  folders.value = f.folders;
  const last = localStorage.getItem('wc:last-template');
  if (last && templates.value.find((t) => t.id === last)) templateId.value = last;
  if (!templates.value.find((t) => t.id === templateId.value)) templateId.value = templates.value[0]?.id ?? 'minimal';
  initValues();
}

function onTemplateChange() { saveTemplateState(previousTemplateId); previousTemplateId = templateId.value; initValues(); }
function onPositionChange() { customX.value = null; customY.value = null; redraw(); }
function setZoom(n: number) { zoom.value = Math.min(4, Math.max(1, Math.round(n * 10) / 10)); }

async function startCamera() {
  cameraError.value = '';
  try {
    stopCamera();
    stream.value = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    if (videoEl.value) {
      videoEl.value.srcObject = stream.value;
      await videoEl.value.play().catch(() => {});
      drawOverlay();
    }
  } catch (e: any) {
    cameraError.value = '无法打开相机：' + (e?.message || e?.name || '未知错误') + '。可用“相册”导入。';
  }
}

function stopCamera() {
  stream.value?.getTracks().forEach((t) => t.stop());
  stream.value = null;
}

function onVideoMeta() { drawOverlay(); }

function drawOverlay() {
  const c = overlayEl.value;
  const v = videoEl.value;
  const t = currentTemplate.value;
  if (!c || !t) return;
  const w = v?.videoWidth || 1080;
  const h = v?.videoHeight || 1920;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  // 空字段在预览里显示占位符，保证选模板后立即能看到水印骨架；
  // 真正上传时仍用 values.value，空字段不会出现在成图中。
  const preview: Record<string, string> = { ...values.value };
  for (const f of fields.value) {
    if (!String(preview[f.key] ?? '').trim()) preview[f.key] = '—';
  }
  const spec = makeSpec({
    templateId: t.id, values: preview, position: position.value,
    x: customX.value, y: customY.value,
    scale: scale.value, heightScale: heightScale.value, opacity: opacity.value, widthRatio: widthRatio.value,
  });
  const layout = drawWatermark(ctx as any, t as unknown as WatermarkTemplate, spec, w, h);
  overlayLayout = layout ? { x: layout.x, y: layout.y, width: layout.width, height: layout.height, fontSize: layout.fontSize } : null;
  overlayHandles = null;
  hitLines = [];
  if (layout) {
    const indent = Math.round(layout.fontSize * 1.4);
    layout.lines.forEach((line, i) => {
      if (!line.fieldKey) return;
      hitLines.push({
        key: line.fieldKey,
        x: layout.x + layout.padding + ((!line.isLabel && !line.isInline) ? indent : 0),
        y: layout.y + layout.padding + i * layout.lineHeight,
        w: layout.width - layout.padding * 2,
        h: layout.lineHeight,
      });
    });
    const hs = Math.max(10, Math.round(layout.fontSize * 0.9));
    const rx = layout.x + layout.width;
    const by = layout.y + layout.height;
    const cx = rx;
    const cy = layout.y + layout.height / 2;
    const bx = layout.x + layout.width / 2;
    overlayHandles = {
      right: { x: cx, y: cy },
      bottom: { x: bx, y: by },
      corner: { x: rx, y: by },
    };
    ctx.save();
    ctx.fillStyle = '#14b8a6';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, hs * 0.18);
    for (const h of Object.values(overlayHandles)) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, hs / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

function hitHandle(clientX: number, clientY: number): 'right' | 'bottom' | 'corner' | null {
  const c = overlayEl.value;
  if (!c || !overlayHandles) return null;
  const rect = c.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width * c.width;
  const y = (clientY - rect.top) / rect.height * c.height;
  const tol = Math.max(18, (overlayLayout?.fontSize ?? 20));
  for (const mode of ['corner', 'right', 'bottom'] as const) {
    const h = overlayHandles[mode];
    if (Math.hypot(x - h.x, y - h.y) <= tol) return mode;
  }
  return null;
}

function redraw() { drawOverlay(); }

function hitAt(clientX: number, clientY: number): { key: string; line: typeof hitLines[number] } | null {
  const c = overlayEl.value;
  if (!c) return null;
  const rect = c.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width * c.width;
  const y = (clientY - rect.top) / rect.height * c.height;
  for (const line of hitLines) {
    if (x >= line.x - 6 && x <= line.x + line.w + 6 && y >= line.y - 2 && y <= line.y + line.h + 2) {
      return { key: line.key, line };
    }
  }
  return null;
}

function openField(key: string, line: typeof hitLines[number]) {
  const field = fields.value.find((f) => f.key === key);
  const c = overlayEl.value;
  if (!field || !c) return;
  const rect = c.getBoundingClientRect();
  const sx = rect.width / c.width;
  const sy = rect.height / c.height;
  const width = Math.min(360, Math.max(220, line.w * sx));
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + line.x * sx));
  const top = Math.max(70, Math.min(window.innerHeight - 180, rect.top + line.y * sy - 40));
  inlineStyle.value = { left: `${left}px`, top: `${top}px`, width: `${width}px` };
  activeField.value = field;
}

function onPointerDown(e: PointerEvent) {
  if (!overlayEl.value) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: scale.value };
    press = null;
    resize = null;
    return;
  }
  if (!overlayLayout) return;
  const handle = hitHandle(e.clientX, e.clientY);
  if (handle) {
    resize = { mode: handle, clientX: e.clientX, clientY: e.clientY, width: widthRatio.value, heightScale: heightScale.value };
    press = null;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    return;
  }
  const c = overlayEl.value;
  const rect = c.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width * c.width;
  const py = (e.clientY - rect.top) / rect.height * c.height;
  if (px < overlayLayout.x || py < overlayLayout.y || px > overlayLayout.x + overlayLayout.width || py > overlayLayout.y + overlayLayout.height) return;
  const hit = hitAt(e.clientX, e.clientY);
  press = { clientX: e.clientX, clientY: e.clientY, baseX: overlayLayout.x, baseY: overlayLayout.y, key: hit?.key, moved: false };
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    scale.value = Math.min(2, Math.max(0.5, Math.round((pinch.scale * d / Math.max(1, pinch.dist)) * 100) / 100));
    drawOverlay();
    return;
  }
  if (resize && overlayEl.value) {
    const dx = e.clientX - resize.clientX;
    const dy = e.clientY - resize.clientY;
    if (resize.mode === 'right' || resize.mode === 'corner') {
      widthRatio.value = Math.min(0.9, Math.max(0.25, resize.width + dx / overlayEl.value.width));
    }
    if (resize.mode === 'bottom' || resize.mode === 'corner') {
      heightScale.value = Math.min(2.5, Math.max(0.5, Math.round((resize.heightScale + dy / 240) * 100) / 100));
    }
    drawOverlay();
    return;
  }
  if (!press || !overlayEl.value) return;
  const dx = e.clientX - press.clientX;
  const dy = e.clientY - press.clientY;
  if (!press.moved && Math.hypot(dx, dy) < 6) return;
  if (!press.moved) {
    press.moved = true;
    customX.value = press.baseX;
    customY.value = press.baseY;
  }
  const rect = overlayEl.value.getBoundingClientRect();
  customX.value = press.baseX + dx / rect.width * overlayEl.value.width;
  customY.value = press.baseY + dy / rect.height * overlayEl.value.height;
  drawOverlay();
}

function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  resize = null;
  if (pointers.size > 0) return;
  if (press && !press.moved && press.key) {
    const hit = hitAt(e.clientX, e.clientY);
    if (hit) openField(hit.key, hit.line);
  }
  press = null;
}

function makePending(blob: Blob): PendingUpload {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    blob,
    filename: 'photo.jpg',
    templateId: templateId.value,
    folderId: folderId.value || undefined,
    values: { ...values.value },
    spec: {
      position: position.value,
      x: customX.value, y: customY.value,
      scale: scale.value, heightScale: heightScale.value, opacity: opacity.value, widthRatio: widthRatio.value,
    },
    createdAt: Date.now(),
  };
}

async function sendUpload(item: PendingUpload): Promise<{ id: string }> {
  const form = new FormData();
  form.append('templateId', item.templateId);
  if (item.folderId) form.append('folderId', item.folderId);
  form.append('values', JSON.stringify(item.values));
  form.append('spec', JSON.stringify(item.spec));
  form.append('file', item.blob, item.filename);
  const res = await fetch('/api/records', { method: 'POST', body: form, credentials: 'same-origin' });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const d = await res.json(); msg = d.message || d.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function refreshPending() {
  try { pendingCount.value = await countPending(); } catch {}
}

async function flushPending() {
  if (!navigator.onLine) return;
  let sent = 0;
  for (const item of await listPending()) {
    try { await sendUpload(item); await deletePending(item.id); sent++; } catch { break; }
  }
  await refreshPending();
  if (sent > 0) { toast.value = `已补传 ${sent} 张`; setTimeout(() => { toast.value = ''; }, 3000); }
}

async function uploadBlob(blob: Blob, valuesOverride?: Record<string, string>) {
  busy.value = true;
  const item = makePending(blob);
  if (valuesOverride) item.values = { ...valuesOverride };
  const localUrl = URL.createObjectURL(blob);
  const token = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  lastSaved.value = { id: '', imageUrl: localUrl, uploading: true, token };
  if (!reuseWatermark.value) resetContent();
  busy.value = false;

  try {
    const rec = await sendUpload(item) as any;
    URL.revokeObjectURL(localUrl);
    if (lastSaved.value?.token === token) {
      lastSaved.value = {
        id: rec.id,
        imageUrl: `/api/files/render/${rec.id}?v=${Date.now()}`,
        uploading: false,
      };
    }
  } catch (e: any) {
    const network = !navigator.onLine || e instanceof TypeError || /fetch|network/i.test(String(e.message));
    if (network) {
      await addPending(item);
      await refreshPending();
      if (lastSaved.value?.token === token) {
        lastSaved.value = { id: '', imageUrl: localUrl, uploading: false, message: '网络不可用，已离线保存，联网后自动补传', token };
      }
    } else {
      if (lastSaved.value?.token === token) {
        lastSaved.value = { id: '', imageUrl: localUrl, uploading: false, message: '上传失败：' + (e.message || '未知'), token };
      }
    }
  }
}

async function translateField(key: string) {
  const sourceKey = key === 'desEs' ? 'desZh' : 'desEs';
  const text = values.value[sourceKey]?.trim();
  if (!text) { toast.value = '请先填写另一种语言的描述'; return; }
  const priority = localStorage.getItem('wc:trans-priority') || 'local-free-llm';
  const whitelist: string[] = JSON.parse(localStorage.getItem('wc:whitelist-phrases') || '[]');
  if (whitelist.some((w) => w && text === w)) { toast.value = '该词组在白名单中，不翻译'; return; }
  const freeEnabled = localStorage.getItem('wc:free-enabled') !== '0';
  let dict: { zh: string; es: string }[] = [];
  try { dict = JSON.parse(localStorage.getItem('wc:dict-pairs') || '[]'); } catch {}
  const order = priority === 'free-local-llm' ? ['free', 'local', 'llm']
    : priority === 'llm-local-free' ? ['llm', 'local', 'free']
    : ['local', 'free', 'llm'];
  const masks: string[] = [];
  let masked = text;
  for (const w of whitelist.filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (masked.includes(w)) {
      const token = `[[W${masks.length}]]`;
      masks.push(w);
      masked = masked.split(w).join(token);
    }
  }
  const restore = (s: string) => masks.reduce((acc, w, i) => acc.split(`[[W${i}]]`).join(w), s);

  const tryLocal = (): string | null => {
    for (const row of dict) {
      if (row.zh === text) return row.es;
      if (row.es === text) return row.zh;
    }
    return null;
  };
  const tryFree = async (): Promise<string | null> => {
    if (!freeEnabled) return null;
    const usage = (() => { try { return JSON.parse(localStorage.getItem('wc:free-usage') || '{}'); } catch { return {}; } })();
    const today = new Date().toISOString().slice(0, 10);
    const used = usage.date === today ? Number(usage.chars) || 0 : 0;
    if (used + text.length > 5000) { toast.value = '免费词典今日额度已用完'; return null; }
    try {
      const res = await api<{ text: string }>('/api/free-translate', {
        method: 'POST', body: JSON.stringify({ text: masked, from: key === 'desEs' ? 'zh' : 'es', to: key === 'desEs' ? 'es' : 'zh' }),
      });
      localStorage.setItem('wc:free-usage', JSON.stringify({ date: today, chars: used + text.length }));
      return res.text;
    } catch { return null; }
  };
  const tryLLM = async (): Promise<string | null> => {
    try {
      const res = await api<{ text: string }>('/api/translate', {
        method: 'POST', body: JSON.stringify({ text: masked, from: key === 'desEs' ? 'zh' : 'es', to: key === 'desEs' ? 'es' : 'zh' }),
      });
      return res.text;
    } catch { return null; }
  };

  translating.value = true;
  try {
    let result: string | null = null;
    for (const engine of order) {
      if (engine === 'local') result = tryLocal();
      else if (engine === 'free') result = await tryFree();
      else result = await tryLLM();
      if (result) break;
    }
    if (result) {
      values.value[key] = restore(result);
      redraw();
    } else {
      toast.value = '翻译失败：本地/免费/大模型都没有结果';
    }
  } finally {
    translating.value = false;
    setTimeout(() => { toast.value = ''; }, 3000);
  }
}

async function capture() {
  const v = videoEl.value;
  if (!v || !v.videoWidth) { toast.value = '相机未就绪'; return; }
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d')!;
  const z = Math.max(1, zoom.value);
  const sw = v.videoWidth / z;
  const sh = v.videoHeight / z;
  ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.95));
  if (!blob) { toast.value = '拍照失败'; return; }
  await uploadBlob(blob);
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  const bitmap = await createImageBitmap(f).catch(() => null);
  if (!bitmap) { toast.value = '无法读取图片'; return; }
  // 系统相机/相册导入：如果字段还没填，用占位符保证按当前模板渲染出水印；
  // 用户之后可以在记录详情里把占位符改成真实内容。
  const importValues = { ...values.value };
  const hasContent = fields.value.some((f) => String(importValues[f.key] ?? '').trim());
  if (!hasContent) {
    for (const f of fields.value) importValues[f.key] = '—';
  }
  await uploadBlob(f, importValues);
  input.value = '';
}

function closeSaved() {
  if (lastSaved.value?.uploading && lastSaved.value.imageUrl.startsWith('blob:')) URL.revokeObjectURL(lastSaved.value.imageUrl);
  lastSaved.value = null;
}

function viewLast() {
  const id = lastSaved.value?.id;
  if (lastSaved.value?.imageUrl.startsWith('blob:')) URL.revokeObjectURL(lastSaved.value.imageUrl);
  lastSaved.value = null;
  if (id) router.push(`/records/${id}`);
}

watch([values, position, scale, opacity, widthRatio, customX, customY], () => {
  saveTemplateState();
}, { deep: true });
watch(templateId, (id) => { try { localStorage.setItem('wc:last-template', id); } catch {} });

onActivated(async () => {
  void syncTranslationSettings().catch(() => {});
  if (videoEl.value && stream.value) {
    await videoEl.value.play().catch(() => {});
    drawOverlay();
  }
});
onDeactivated(() => {
  // Keep the media stream alive so returning from records/settings does not re-prompt the camera.
  videoEl.value?.pause();
});

onMounted(async () => {
  await syncTranslationSettings().catch(() => {});
  await loadTemplates();
  await refreshPending();
  await startCamera();
  await flushPending();
  window.addEventListener('online', flushPending);
});
onBeforeUnmount(() => {
  stopCamera();
  window.removeEventListener('online', flushPending);
});
</script>
