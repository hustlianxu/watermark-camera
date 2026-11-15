import type { WatermarkTemplate } from './types.js';

const baseStyle = {
  fontSize: 22,
  color: '#ffffff',
  background: 'rgba(0,0,0,0.70)',
  padding: 14,
  borderRadius: 10,
  lineHeight: 1.35,
};

export const TEMPLATES: WatermarkTemplate[] = [
  {
    id: 'handwrite',
    name: '手写·双语',
    description: '货号 + 西语描述 + 中文描述 + 单价 + 装箱数 + 件数 + 体积 + 重量 + 备注 + 日期',
    isBuiltin: true,
    position: 'bottom-center',
    widthRatio: 0.42,
    style: { ...baseStyle },
    fields: [
      { key: 'modelo', label: '货号 · Modelo / Código', type: 'text', placeholder: '如：RL-034 · HB098' },
      { key: 'desEs', label: 'Descripción ES · 西语描述', type: 'textarea', multiline: true, placeholder: '如：6 estrellas grande + 6 estrellas chicas' },
      { key: 'desZh', label: 'Descripción ZH · 中文描述', type: 'textarea', multiline: true, placeholder: '如：6 大星星 + 6 小星星挂灯' },
      { key: 'precio', label: '单价 · Precio unitario', type: 'text', placeholder: '如：¥11 · $0.65' },
      { key: 'pzs', label: '每箱件数 · Pzs / caja', type: 'text', placeholder: '如：48 pzs / caja' },
      { key: 'cajas', label: '件数 · Total cajas / pzs', type: 'text', placeholder: '如：50 cajas · 1200 pzs' },
      { key: 'volumen', label: '体积 · Volumen', type: 'text', placeholder: '如：0.125 m³' },
      { key: 'peso', label: '重量 · Peso', type: 'text', placeholder: '如：2.5 kg' },
      { key: 'nota', label: '备注 · Nota', type: 'textarea', multiline: true, placeholder: '如：con luz y música' },
      { key: 'fecha', label: '日期 · Fecha', type: 'datetime' },
    ],
  },
  {
    id: 'minimal',
    name: '极简模板',
    description: '货号 + 单价 + 描述 + 装箱数 + 体积 + 件数',
    isBuiltin: true,
    position: 'bottom-center',
    widthRatio: 0.42,
    style: { ...baseStyle },
    fields: [
      { key: 'modelo', label: '货号 · Modelo', type: 'text' },
      { key: 'precio', label: '单价 · Precio ￥', type: 'text' },
      { key: 'desEs', label: '描述 · Des.', type: 'textarea', multiline: true },
      { key: 'pzs', label: '装箱数 · Pzas/Caja', type: 'text' },
      { key: 'volumen', label: '体积 · Cúbico', type: 'text' },
      { key: 'cajas', label: '件数 · Cajas', type: 'text' },
    ],
  },
  {
    id: 'handwriteSimple',
    name: '手写·精简',
    description: '货号 + 西语描述 + 单价 + 装箱数 + 体积',
    isBuiltin: true,
    position: 'bottom-center',
    widthRatio: 0.42,
    style: { ...baseStyle, fontSize: 24 },
    fields: [
      { key: 'modelo', label: '货号 · Modelo', type: 'text' },
      { key: 'desEs', label: 'Descripción ES', type: 'textarea', multiline: true },
      { key: 'precio', label: '单价 · Precio', type: 'text' },
      { key: 'pzs', label: '每箱 · Pzs / caja', type: 'text' },
      { key: 'cajas', label: '件数 · Total', type: 'text' },
      { key: 'volumen', label: '体积 · Volumen', type: 'text' },
    ],
  },
];

export function getTemplateById(id: string): WatermarkTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
