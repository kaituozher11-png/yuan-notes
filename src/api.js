import { offlineApi } from './offlineStore';

export async function api(path, options = {}) {
  if (window.YuanOfflineApp) return offlineApi(path, options);
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers };
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) headers['X-Yingxing-Request'] = '1';
  const response = await fetch(`/api${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) window.dispatchEvent(new Event('yingxing:unauthorized'));
  if (!response.ok) {
    const error = new Error(data.error || `请求失败 (${response.status})`);
    if (['ASSISTANT_FORMAT', 'ASSISTANT_TRUNCATED'].includes(data.code)) error.code = data.code;
    throw error;
  }
  return data;
}
export const json = (method, body) => ({ method, body: JSON.stringify(body) });
