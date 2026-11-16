import { drawWatermark, makeSpec, type Position, type WatermarkTemplate } from '@wc/core';
import type { Template } from './api';

export interface WatermarkSpecInput {
  position: Position;
  x: number | null;
  y: number | null;
  scale: number;
  heightScale: number;
  opacity: number;
  widthRatio: number;
}

export interface RenderedLocalPhoto {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Render the same watermark on the device before upload. This is what makes a
 * local copy useful when the server/remote data is lost: the backup already
 * contains the watermark, not just the original photo.
 */
export async function renderLocalWatermarkedPhoto(
  source: Blob,
  template: Template,
  values: Record<string, string>,
  spec: WatermarkSpecInput,
): Promise<RenderedLocalPhoto> {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('CANVAS_UNAVAILABLE');
  }
  ctx.drawImage(bitmap, 0, 0);
  const normalized = makeSpec({
    templateId: template.id,
    values,
    position: spec.position,
    x: spec.x ?? undefined,
    y: spec.y ?? undefined,
    scale: spec.scale,
    heightScale: spec.heightScale,
    opacity: spec.opacity,
    widthRatio: spec.widthRatio,
  });
  drawWatermark(
    ctx as any,
    template as unknown as WatermarkTemplate,
    normalized,
    canvas.width,
    canvas.height,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('LOCAL_RENDER_FAILED');
  return { blob, width: canvas.width, height: canvas.height };
}

export function makeLocalPhotoFilename(id: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `wc-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${id.slice(0, 8)}.jpg`;
}
