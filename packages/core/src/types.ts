export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'time'
  | 'select'
  | 'location';

export type Position =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  multiline?: boolean;
  options?: string[];
  placeholder?: string;
  default?: string;
}

export interface TemplateStyle {
  fontSize: number;
  color: string;
  background: string;
  padding: number;
  borderRadius: number;
  lineHeight: number;
}

export interface WatermarkTemplate {
  id: string;
  name: string;
  description?: string;
  isBuiltin: boolean;
  position: Position;
  widthRatio: number;
  style: TemplateStyle;
  fields: TemplateField[];
}

export interface WatermarkSpec {
  templateId: string;
  templateVersion: number;
  position: Position;
  x: number | null;
  y: number | null;
  scale: number;
  heightScale: number;
  opacity: number;
  widthRatio: number;
  styleOverrides?: Partial<TemplateStyle>;
  values: Record<string, string>;
  rendererVersion: string;
}

export interface RenderedLine {
  fieldKey?: string;
  text: string;
  isLabel: boolean;
  isInline: boolean;
  labelPart?: string;
  valuePart?: string;
  color: string;
}

export interface LayoutResult {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  padding: number;
  borderRadius: number;
  backgroundColor: string;
  lines: RenderedLine[];
}

/** Minimal Canvas 2D surface used by both browser and @napi-rs/canvas. */
export interface Canvas2DLike {
  font: string;
  textBaseline: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  closePath(): void;
  fill(): void;
}

export const FONT_FAMILY = '"Noto Sans SC", Inter, -apple-system, "PingFang SC", sans-serif';
export const RENDERER_VERSION = '1.0.0';
export const FONT_VERSION = 'noto-sans-sc-1.0.0+inter-1.0.0';
