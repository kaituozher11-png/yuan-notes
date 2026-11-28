import { renderToStaticMarkup } from 'react-dom/server';
import { MapElements } from './MindMapSvg';
import { mapExportBounds, normalizeMap } from './mindMapModel';

export function mindMapSvg(value) {
  const map = normalizeMap(value), bounds = mapExportBounds(map);
  return '<?xml version="1.0" encoding="UTF-8"?>' + renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width={Math.ceil(bounds.width)} height={Math.ceil(bounds.height)} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}><rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="white"/><MapElements nodes={map.nodes} edges={map.edges}/></svg>);
}
export async function saveMapBlob(blob, filename) {
  const bridge = window.YingxingAndroidDownload;
  if (bridge?.begin && bridge?.chunk && bridge?.finish) {
    bridge.begin(filename, blob.type);
    try { for (let start = 0; start < blob.size; start += 96 * 1024) { const bytes = new Uint8Array(await blob.slice(start, start + 96 * 1024).arrayBuffer()); let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte); bridge.chunk(btoa(raw)); } bridge.finish(); }
    catch (error) { bridge.cancel(); throw error; }
    return;
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function exportMindMap(value, format) {
  if (!['json', 'svg', 'png'].includes(format)) throw new Error('不支持的导图导出格式');
  const map = normalizeMap(value);
  if (format === 'json') return saveMapBlob(new Blob([JSON.stringify({ format: 'yuan-notes-mindmap', version: 1, ...map }, null, 2)], { type: 'application/json' }), '源笔记-思维导图.json');
  const svg = mindMapSvg(map);
  if (format === 'svg') return saveMapBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), '源笔记-思维导图.svg');
  const bounds = mapExportBounds(map), scale = Math.min(2, 8192 / bounds.width, 8192 / bounds.height, Math.sqrt(16_000_000 / (bounds.width * bounds.height)));
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('无法绘制导图图片，请改用SVG导出')); });
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bounds.width * scale)); canvas.height = Math.max(1, Math.round(bounds.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('无法生成图片，请改用SVG导出');
    await saveMapBlob(blob, '源笔记-思维导图.png');
  } finally { URL.revokeObjectURL(url); }
}
export { parseMindMapFile } from './mindMapModel';
