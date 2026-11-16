<template>
  <div class="card">
    <div class="row" style="justify-content:space-between;align-items:center">
      <div>
        <strong>本地备份</strong>
        <p class="hint" style="margin:4px 0 0">
          当前设备/浏览器内的水印照片，不依赖服务器。共 {{ photos.length }} 张，约 {{ totalMb }} MB。
        </p>
      </div>
      <router-link class="btn secondary" to="/settings">返回设置</router-link>
    </div>

    <p class="hint" style="margin-top:10px">
      这是 App 自己的本地备份，不会自动写入系统相册；点“保存到相册”会打开系统分享面板，选择“存储图像/保存到相册”。
      清理浏览器数据会删除这里的备份。
    </p>

    <div v-if="!photos.length" class="hint" style="margin-top:15px">暂无本地备份</div>
    <div
      v-else
      style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-top:14px"
    >
      <figure v-for="p in photos" :key="p.id" style="margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff">
        <img :src="urls[p.id]" alt="本地水印照片" style="display:block;width:100%;height:150px;object-fit:cover;background:#f3f4f6" />
        <figcaption style="padding:8px">
          <div class="hint">{{ new Date(p.createdAt).toLocaleString() }} · {{ sizeText(p.blob.size) }}</div>
          <div class="hint" style="margin-top:2px">{{ p.remoteId ? '已同步远程' : '仅本机' }}</div>
          <div class="row" style="margin-top:8px;gap:4px;flex-wrap:wrap">
            <button class="dock-mini" @click="saveToAlbum(p)">保存到相册</button>
            <button class="dock-mini" @click="download(p)">下载</button>
            <button class="dock-mini" style="background:#dc2626" @click="remove(p)">删除</button>
          </div>
        </figcaption>
      </figure>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { deleteLocalPhoto, listLocalPhotos, type LocalPhoto } from '../localPhotos';
import { downloadBlob, saveBlobToAlbum } from '../saveToAlbum';

const photos = ref<LocalPhoto[]>([]);
const urls = ref<Record<string, string>>({});
const toast = ref('');

const totalMb = computed(() => {
  const bytes = photos.value.reduce((sum, p) => sum + p.blob.size, 0);
  return (bytes / 1024 / 1024).toFixed(1);
});

function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function showToast(s: string) {
  toast.value = s;
  setTimeout(() => { toast.value = ''; }, 3000);
}
async function load() {
  photos.value = await listLocalPhotos();
  for (const p of photos.value) {
    if (!urls.value[p.id]) urls.value[p.id] = URL.createObjectURL(p.blob);
  }
}
async function saveToAlbum(p: LocalPhoto) {
  try {
    const result = await saveBlobToAlbum(p.blob, p.filename);
    if (result === 'shared') showToast('已打开系统分享面板，请选择“存储图像/保存到相册”');
    else if (result === 'downloaded') showToast('已开始下载水印照片');
  } catch {
    showToast('无法打开分享面板，请改用“下载”');
  }
}
function download(p: LocalPhoto) {
  downloadBlob(p.blob, p.filename);
  showToast('已开始下载');
}
async function remove(p: LocalPhoto) {
  if (!confirm('删除这条本地备份？远程记录不受影响。')) return;
  await deleteLocalPhoto(p.id);
  const url = urls.value[p.id];
  if (url) URL.revokeObjectURL(url);
  delete urls.value[p.id];
  await load();
}

onMounted(load);
onBeforeUnmount(() => {
  for (const url of Object.values(urls.value)) URL.revokeObjectURL(url);
});
</script>
