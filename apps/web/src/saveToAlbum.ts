export type SaveAlbumResult = 'shared' | 'downloaded' | 'cancelled';

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-') || 'watermark.jpg';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeName(filename);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The browser cannot silently write the system photo album. On iOS/Android the
 * supported path is the system share sheet ("存储图像"/"保存到相册"); desktop
 * falls back to a normal download.
 */
export async function saveBlobToAlbum(blob: Blob, filename: string): Promise<SaveAlbumResult> {
  const file = new File([blob], sanitizeName(filename), { type: blob.type || 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '水印照片' });
      return 'shared';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled';
      // Fall through to download when sharing is unavailable or fails.
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
