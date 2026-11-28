import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { pdfDocumentOptions } from './pdfAssets';
import { generateOrganizedNote, validateGenerationMode, validateAiGuidance, validateAiOutline } from './aiNoteOutline';
import { requestAssistantTurn } from './assistantProtocol';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const maxResponse = 2_000_000;
let nextRequest = 0;
const requests = new Map();

export function modelOnline() {
  try { return window.YuanModelBridge ? window.YuanModelBridge.isOnline() : navigator.onLine; }
  catch { return false; }
}

export function normalizeModelEndpoint(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.local') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) throw new Error('手机模型接口必须使用公网 HTTPS 地址');
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/chat/completions')) url.pathname = `${path}/chat/completions`;
  return url.toString();
}

function encodeRequest(value) {
  return JSON.stringify(value);
}

function nativeRequest(url, payload, key, signal) {
  signal?.throwIfAborted();
  if (!window.YuanModelBridge) return fetch(url, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: encodeRequest(payload), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
  }).then(async (response) => ({ status: response.status, body: await response.text() }));
  return new Promise((resolve, reject) => {
    const id = String(++nextRequest);
    const cleanup = () => { clearTimeout(timer); requests.delete(id); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal.reason || new DOMException('已停止', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('模型请求超时')); }, 125000);
    signal?.addEventListener('abort', abort, { once: true });
    requests.set(id, (result) => { cleanup(); resolve(result); });
    try { window.YuanModelBridge.request(id, url, encodeRequest(payload), key); }
    catch (error) { cleanup(); reject(error); }
  });
}

export async function callOfflineAssistant(input) {
  if (!modelOnline()) throw new Error('智能助手需要联网，请联网后重试');
  if (!input.key || !input.model) throw new Error('请先选择并解锁模型连接');
  return requestAssistantTurn(input, async ({ messages, jsonMode }) => {
    const response = await nativeRequest(normalizeModelEndpoint(input.endpoint), {
      model: input.model, messages, temperature: 0.2, max_tokens: 6000,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }, input.key, input.signal);
    input.signal?.throwIfAborted();
    if (response.status !== 200) throw serviceError(response.status, response.body.slice(0, maxResponse), input.key);
    let data;
    try { data = JSON.parse(response.body.slice(0, maxResponse)); }
    catch { throw new Error('助手返回内容不是有效 JSON'); }
    return data.choices?.[0];
  });
}

export async function readOfflineText(docId, page, loadPdf) {
  const loading = pdfjs.getDocument({ data: await loadPdf(docId), ...pdfDocumentOptions });
  try {
    const source = await (await loading.promise).getPage(page);
    const content = await source.getTextContent();
    return { text: content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').slice(0, 20000) };
  } finally { await loading.destroy(); }
}

if (typeof window !== 'undefined') {
  window.__yuanModelResponse = (id, status, base64) => {
    const finish = requests.get(String(id));
    if (!finish) return;
    requests.delete(String(id));
    try {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      finish({ status, body: new TextDecoder().decode(bytes) });
    } catch { finish({ status: 0, body: '' }); }
  };
}

function parseAnswer(answer, finishReason, test) {
  const raw = answer.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  for (const value of [raw, fenced, start >= 0 && end > start ? raw.slice(start, end + 1) : null]) {
    if (!value) continue;
    try {
      const parsed = JSON.parse(value.trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* Continue with the next wrapper. */ }
  }
  if (finishReason === 'length' || finishReason === 'max_tokens') throw new Error('模型输出被截断，请改用输出上限更高的模型');
  throw new Error(test ? '模型已连接，但未按要求返回笔记格式' : '模型未返回可读取的笔记格式');
}

function serviceError(status, body, key) {
  const fallback = status === 401 || status === 403 ? '密钥无效或无权使用此模型'
    : status === 402 ? '模型账户余额不足'
    : status === 429 ? '请求过于频繁或额度已用完'
    : status ? `模型服务返回错误 ${status}` : '无法连接模型服务商，请检查网络和接口地址';
  let detail = '';
  try {
    const data = JSON.parse(body);
    detail = typeof data.error === 'string' ? data.error : data.error?.message || data.message || '';
  } catch { /* Use the status message. */ }
  detail = String(detail).replaceAll(key, '[已隐藏]').replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [已隐藏]')
    .replace(/sk-[\w-]+/gi, '[已隐藏]').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 300);
  return new Error(detail ? `${fallback}：${detail}` : fallback);
}

export async function callOfflineModel({ endpoint, key, model, page, text, image, outline, mode = 'template', guidance = '', test = false, signal }) {
  if (!modelOnline()) throw new Error('无法生成智能笔记，请联网');
  if (!key || !model) throw new Error('请填写模型名称和 API 密钥');
  const url = normalizeModelEndpoint(endpoint);
  const content = test ? '请返回最小笔记 JSON。' : [{ type: 'text', text: `第 ${page} 页提取文字：\n${text || '无可提取文字，请依据页面图片，并标注需核对。'}` }, ...(image ? [{ type: 'image_url', image_url: { url: image } }] : [])];
  const request = async (instruction, stage) => {
    signal?.throwIfAborted();
    let response;
    try {
      response = await nativeRequest(url, {
        model, messages: [{ role: 'system', content: instruction }, { role: 'user', content }],
        temperature: test ? 0 : 0.2, max_tokens: test ? 512 : stage === 'plan' ? 1000 : 3500,
      }, key, signal);
      signal?.throwIfAborted();
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(modelOnline() ? '无法连接模型服务商，请检查网络和接口地址' : '无法生成智能笔记，请联网');
    }
    if (response.status !== 200) {
      if (!modelOnline()) throw new Error('无法生成智能笔记，请联网');
      throw serviceError(response.status, response.body.slice(0, maxResponse), key);
    }
    let data;
    try { data = JSON.parse(response.body.slice(0, maxResponse)); }
    catch { throw new Error('模型返回内容不是有效 JSON'); }
    const choice = data.choices?.[0];
    if (typeof choice?.message?.content !== 'string') throw new Error('模型返回内容格式不兼容');
    if (choice.finish_reason === 'length' || choice.finish_reason === 'max_tokens') throw new Error('模型输出被截断，暂未保存笔记；请更换输出上限更高的模型');
    return parseAnswer(choice.message.content, choice.finish_reason, test);
  };

  if (test) {
    const ai = await request('这是格式测试。只返回合法 JSON 对象：{"summary":"连接正常","concepts":[],"important":[],"cautions":[],"formula":[],"quiz":[]}。不要解释或代码块。');
    if (typeof ai.summary !== 'string') throw new Error('模型已连接，但未按要求返回笔记格式');
    return { ok: true };
  }
  return generateOrganizedNote({ page, outline, guidance, mode, signal, request });
}

export async function generateOfflinePage({ docId, page, endpoint, key, model, vision, outline, mode = 'template', guidance = '', signal }, loadPdf) {
  if (!modelOnline()) throw new Error('无法生成智能笔记，请联网');
  validateGenerationMode(mode);
  if (mode === 'template' && outline !== undefined) validateAiOutline(outline);
  validateAiGuidance(guidance);
  const loading = pdfjs.getDocument({ data: await loadPdf(docId), ...pdfDocumentOptions });
  let text;
  let image;
  try {
    const document = await loading.promise;
    const source = await document.getPage(page);
    const content = await source.getTextContent();
    text = content.items.map((item) => item.str || '').join(' ').trim().slice(0, 20000);
    if (vision) {
      const base = source.getViewport({ scale: 1 });
      const viewport = source.getViewport({ scale: Math.min(2, 1200 / Math.max(base.width, base.height)) });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await source.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      image = canvas.toDataURL('image/jpeg', 0.75);
    }
  } finally { await loading.destroy(); }
  if (!text && !image) throw new Error('此页没有可提取文字，请使用支持图片的模型');
  signal?.throwIfAborted();
  return callOfflineModel({ endpoint, key, model, page, text, image, outline, mode, guidance, signal });
}
