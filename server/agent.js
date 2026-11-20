import { pageText, pageImage } from './documents.js';
import net from 'node:net';
import { modelDispatcher, publicModelDispatcher } from './model-network.js';

export function normalizeEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('接口必须使用 HTTPS；本机接口可使用 HTTP');
  if (url.username || url.password) throw new Error('接口地址不能包含账号或密码');
  if (process.env.YINGXING_PUBLIC === '1' && (
    url.protocol !== 'https:' || net.isIP(url.hostname) ||
    url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
    url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')
  )) throw new Error('公开网页版只允许使用公网 HTTPS 模型接口');
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/chat/completions')) return url.toString();
  url.pathname = `${pathname}/chat/completions`;
  return url.toString();
}

function parseNoteAnswer(answer, finishReason, test) {
  const text = answer.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const candidates = [text, fenced, start >= 0 && end > start ? text.slice(start, end + 1) : null];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const note = JSON.parse(candidate.trim());
      if (note && typeof note === 'object' && !Array.isArray(note)) return note;
    } catch { /* Try the next common response wrapper. */ }
  }
  if (finishReason === 'length' || finishReason === 'max_tokens')
    throw new Error('模型输出被截断，未能形成完整笔记；请改用输出上限更高的模型');
  throw new Error(test
    ? '模型已连接，但未按要求返回笔记格式；请核对模型 ID 或更换模型'
    : '模型未返回可读取的笔记格式；可先关闭页面图片再试，或更换模型');
}

async function modelServiceError(response, key) {
  const status = response.status;
  const fallback = status === 401 || status === 403 ? '密钥无效或无权使用此模型'
    : status === 402 ? '模型账户余额不足'
    : status === 429 ? '请求过于频繁或额度已用完'
    : status === 400 ? '模型服务返回错误 400：请核对接口地址、模型 ID 和请求参数'
    : `模型服务返回错误 ${status}`;
  let body;
  try { body = await response.json(); } catch { return new Error(fallback); }
  const message = typeof body?.error === 'string' ? body.error
    : typeof body?.error?.message === 'string' ? body.error.message
    : typeof body?.message === 'string' ? body.message : '';
  const detail = message.replaceAll(String(key), '[已隐藏]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [已隐藏]')
    .replace(/sk-[\w-]+/gi, '[已隐藏]')
    .replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 300);
  if (!detail) return new Error(fallback);
  return new Error(`${status === 401 || status === 403 || status === 402 || status === 429 ? fallback : `模型服务返回错误 ${status}`}：${detail}`);
}

export async function callModel({ endpoint, key, model, page, text, image, signal, test = false }) {
  const url = normalizeEndpoint(endpoint);
  if (!key || !model) throw new Error('请填写模型名称和 API 密钥');
  const instruction = test
    ? '这是格式测试。只返回合法 JSON 对象：{"summary":"连接正常","concepts":[],"important":[],"cautions":[],"formula":[],"quiz":[]}。不要解释或代码块。'
    : `你是学习笔记整理助手。仅依据提供的第 ${page} 页资料，返回一个合法 JSON 对象，不要代码块或额外说明。字段：summary 字符串；concepts、important、cautions、formula、quiz 为字符串数组。JSON 字符串中的 LaTeX 反斜杠必须按 JSON 规则转义。formula 中每条可确认的数学公式用 LaTeX 的 $...$ 包裹，函数名用 \\operatorname{}，乘号用 \\times；公式后的中文说明写在 $...$ 外。仅有文字说明时保留文字，不猜测缺失的公式。资料不明确时说明待核对，不编造。`;
  const content = test ? '请返回最小笔记 JSON。' : [{ type: 'text', text: `第 ${page} 页提取文字：\n${text || '无可提取文字，请依据页面图片，并标注需核对。'}` }, ...(image ? [{ type: 'image_url', image_url: { url: image } }] : [])];
  let response;
  try {
    response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'system', content: instruction }, { role: 'user', content }], temperature: test ? 0 : 0.2, max_tokens: test ? 512 : 2200 }), signal, dispatcher: process.env.YINGXING_PUBLIC === '1' ? publicModelDispatcher() : modelDispatcher(url) });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (error.name === 'TimeoutError') throw new Error('连接模型服务商超时，请检查网络或代理');
    throw new Error('无法连接模型服务商，请检查网络、代理和接口地址');
  }
  if (!response.ok) {
    throw await modelServiceError(response, key);
  }
  const body = await response.json();
  const choice = body.choices?.[0];
  const answer = choice?.message?.content;
  if (typeof answer !== 'string') throw new Error('模型返回内容格式不兼容');
  const ai = parseNoteAnswer(answer, choice?.finish_reason, test);
  if (!ai || typeof ai.summary !== 'string') throw new Error('模型返回的笔记缺少摘要');
  if (test) return { ok: true };
  for (const field of ['concepts', 'important', 'cautions', 'formula', 'quiz']) ai[field] = Array.isArray(ai[field]) ? ai[field].map(String) : [];
  delete ai.evidence;
  return ai;
}

export async function generatePage({ docId, page, endpoint, key, model, vision, signal }) {
  const text = await pageText(docId, page);
  const image = vision ? await pageImage(docId, page) : null;
  if (!text && !image) throw new Error('此页没有可提取文字，请使用支持图片的模型');
  return callModel({ endpoint, key, model, page, text, image, signal });
}
