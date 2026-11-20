import { api } from './api';

export async function uploadNoteImage(file) {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG、GIF 或 WebP 图片');
  if (file.size > 5 * 1024 * 1024) throw new Error('图片不能超过 5 MB');
  const form = new FormData();
  form.append('image', file);
  return api('/images', { method: 'POST', body: form });
}

export function pastedImage(clipboard) {
  return [...clipboard.files].find((item) => item.type.startsWith('image/'))
    || [...clipboard.items].find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
}
