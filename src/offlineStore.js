import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { callOfflineModel, generateOfflinePage } from './offlineModel';
import { pdfDocumentOptions } from './pdfAssets';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const emptyState = () => ({ docs: [], notes: [], templates: [] });
let database;
let writeQueue = Promise.resolve();
const previews = new Map();

function db() {
  database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('yuan-notes-offline', 1);
    request.onupgradeneeded = () => {
      const store = request.result;
      store.createObjectStore('state');
      store.createObjectStore('pdfs');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

async function read(store, key) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function write(state, pdfs = [], replacePdfs = false) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['state', 'pdfs'], 'readwrite');
    tx.objectStore('state').put(state, 'current');
    if (replacePdfs) tx.objectStore('pdfs').clear();
    for (const [id, file] of pdfs) tx.objectStore('pdfs').put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('手机存储空间不足'));
  });
}

async function state() {
  const saved = await read('state', 'current') || emptyState();
  saved.docs ||= [];
  saved.notes ||= [];
  saved.templates ||= [];
  return saved;
}

function change(fn, pdfs = []) {
  const next = writeQueue.catch(() => {}).then(async () => {
    const current = await state();
    const result = fn(current);
    await write(current, pdfs);
    return result;
  });
  writeQueue = next;
  return next;
}

function body(options) {
  return options.body ? JSON.parse(options.body) : {};
}

function currentDoc(current, id) {
  return current.docs.find((doc) => doc.id === id && !doc.deleted);
}

async function readPageCount(source) {
  const loading = pdfjs.getDocument({ ...source, ...pdfDocumentOptions });
  try { return (await loading.promise).numPages; }
  finally { await loading.destroy(); }
}

async function importPdf(file, course) {
  if (!file) throw new Error('请选择文件');
  if (!/\.pdf$/i.test(file.name)) throw new Error('离线版目前仅支持 PDF；请先将 Word 或 PPT 转为 PDF');
  if (file.size < 8 || file.size > 100 * 1024 * 1024) throw new Error('PDF 文件大小须在 100 MB 以内');
  const buffer = await file.arrayBuffer();
  if (new TextDecoder('ascii').decode(buffer.slice(0, 5)) !== '%PDF-') throw new Error('文件不是有效的 PDF');
  let pages;
  try {
    pages = await readPageCount({ data: new Uint8Array(buffer.slice(0)) });
  } catch (firstError) {
    if (firstError?.name === 'PasswordException') throw new Error('PDF 需要密码，请先解除密码保护后导入');
    const url = URL.createObjectURL(file);
    try {
      pages = await readPageCount({ url });
    } catch (secondError) {
      if (secondError?.name === 'PasswordException') throw new Error('PDF 需要密码，请先解除密码保护后导入');
      const detail = [firstError, secondError].map((error) => String(error?.message || error?.name || '未知原因').replace(/\s+/g, ' ').slice(0, 100));
      throw new Error(`PDF 解析失败：${detail.join('；重试结果：')}`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const now = new Date().toISOString();
  const doc = {
    id: crypto.randomUUID(), name: file.name.replace(/\.pdf$/i, '').slice(0, 150), filename: file.name,
    type: 'PDF', pages, course: String(course || '').trim().slice(0, 100), tags: [], deleted: false,
    createdAt: now, updatedAt: now,
  };
  return change((current) => { current.docs.unshift(doc); return doc; }, [[doc.id, new Blob([buffer], { type: 'application/pdf' })]]);
}

function imageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取图片'));
    reader.readAsDataURL(file);
  });
}

export async function offlinePdf(id) {
  const file = await read('pdfs', id);
  if (!file) throw new Error('原文文件不存在，请从备份恢复');
  return file.arrayBuffer();
}

export async function offlineApi(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (path === '/auth/session' && method === 'GET') return { mode: 'local', user: null };
  if (path === '/state' && method === 'GET') { await writeQueue.catch(() => {}); return state(); }
  if (path === '/docs' && method === 'POST') return importPdf(options.body.get('file'), options.body.get('course'));
  if (path === '/images' && method === 'POST') {
    const image = options.body.get('image');
    if (!image || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.type) || image.size > 5 * 1024 * 1024) throw new Error('仅支持 5 MB 以内的 PNG、JPEG、GIF 或 WebP 图片');
    return { url: await imageAsDataUrl(image) };
  }
  let match = path.match(/^\/docs\/([^/]+)\/pages\/(\d+)\/markup$/);
  if (match && method === 'PUT') return change((current) => {
    const doc = currentDoc(current, match[1]);
    if (!doc || Number(match[2]) < 1 || Number(match[2]) > doc.pages) throw new Error('原文页不存在');
    doc.markup ||= {};
    doc.markup[match[2]] = body(options);
    doc.updatedAt = new Date().toISOString();
    return doc.markup[match[2]];
  });
  match = path.match(/^\/docs\/([^/]+)$/);
  if (match && method === 'PATCH') return change((current) => {
    const doc = current.docs.find((item) => item.id === match[1]);
    if (!doc) throw new Error('资料不存在');
    const fields = body(options);
    if (typeof fields.deleted === 'boolean') doc.deleted = fields.deleted;
    if (typeof fields.name === 'string') doc.name = fields.name.trim().slice(0, 150) || doc.name;
    if (typeof fields.course === 'string') doc.course = fields.course.trim().slice(0, 100);
    doc.updatedAt = new Date().toISOString();
    return doc;
  });
  if (path === '/notes' && method === 'POST') return change((current) => {
    const fields = body(options);
    const doc = currentDoc(current, fields.docId);
    const page = Number(fields.page);
    if (!doc || !Number.isInteger(page) || page < 1 || page > doc.pages) throw new Error('原文页不存在');
    const now = new Date().toISOString();
    const order = Math.max(0, ...current.notes.filter((note) => note.docId === doc.id && note.page === page && !note.deleted).map((note) => Number(note.order || 0))) + 1;
    const note = { id: crypto.randomUUID(), docId: doc.id, page, order, title: String(fields.title || '我的补充').slice(0, 100), kind: fields.kind === 'ai' ? 'ai' : 'user', ai: null, blocks: [], links: [], status: 'new', deleted: false, createdAt: now, updatedAt: now };
    current.notes.push(note);
    return note;
  });
  match = path.match(/^\/notes\/([^/]+)$/);
  if (match && method === 'PUT') return change((current) => {
    const note = current.notes.find((item) => item.id === match[1]);
    if (!note) throw new Error('笔记不存在');
    const fields = body(options);
    for (const field of ['title', 'ai', 'blocks', 'links', 'status', 'deleted', 'style']) if (field in fields) note[field] = fields[field];
    note.updatedAt = new Date().toISOString();
    return note;
  });
  if (path === '/notes/reorder' && method === 'POST') return change((current) => {
    const ids = body(options).ids;
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('笔记顺序无效');
    const notes = ids.map((id) => current.notes.find((note) => note.id === id && !note.deleted));
    if (notes.some((note) => !note) || notes.some((note) => note.docId !== notes[0].docId || note.page !== notes[0].page)) throw new Error('只能调整同一页的笔记');
    if (current.notes.filter((note) => note.docId === notes[0].docId && note.page === notes[0].page && !note.deleted).length !== ids.length) throw new Error('笔记列表已更新，请刷新后重试');
    notes.forEach((note, index) => { note.order = index + 1; });
    return notes;
  });
  if (path === '/templates' && method === 'POST') return change((current) => {
    const fields = body(options);
    const template = { id: crypto.randomUUID(), name: String(fields.name || '新模板').slice(0, 80), sections: fields.sections || ['课堂重点', '我的疑问'], style: fields.style || { accent: '#176d72', paper: 'plain' }, createdAt: new Date().toISOString() };
    current.templates.push(template);
    return template;
  });
  match = path.match(/^\/templates\/([^/]+)$/);
  if (match && method === 'PUT') return change((current) => {
    const template = current.templates.find((item) => item.id === match[1]);
    if (!template) throw new Error('模板不存在');
    const fields = body(options);
    template.name = String(fields.name || template.name).slice(0, 80);
    if (Array.isArray(fields.sections)) template.sections = fields.sections.map((value) => String(value).slice(0, 80));
    if (fields.style) template.style = fields.style;
    return template;
  });
  if (match && method === 'DELETE') return change((current) => {
    current.templates = current.templates.filter((item) => item.id !== match[1]);
    return { ok: true };
  });
  if (path === '/models/test' && method === 'POST') return callOfflineModel({ ...body(options), test: true });
  if (path === '/generate' && method === 'POST') {
    const fields = body(options);
    const current = await state();
    const doc = currentDoc(current, fields.docId);
    const page = Number(fields.page);
    if (!doc || !Number.isInteger(page) || page < 1 || page > doc.pages) throw new Error('原文页不存在');
    const existing = current.notes.find((note) => note.docId === doc.id && note.page === page && note.kind === 'ai' && !note.deleted);
    if (existing && !fields.preview) throw new Error('本页已有智能笔记，请单页预览差异后确认替换');
    const ai = await generateOfflinePage({ ...fields, page }, offlinePdf);
    if (fields.preview) {
      const token = crypto.randomUUID();
      previews.set(token, { docId: doc.id, page, ai, createdAt: Date.now() });
      return { token, ai, previous: existing?.ai || null };
    }
    return change((next) => {
      let note = next.notes.find((item) => item.docId === doc.id && item.page === page && item.kind === 'ai' && !item.deleted);
      if (!note) {
        note = { id: crypto.randomUUID(), docId: doc.id, page, order: 0, title: `第 ${page} 页 · 智能笔记`, kind: 'ai', blocks: [], links: [], createdAt: new Date().toISOString(), deleted: false };
        next.notes.push(note);
      }
      note.ai = ai;
      note.status = 'done';
      note.updatedAt = new Date().toISOString();
      return note;
    });
  }
  if (path === '/generate/commit' && method === 'POST') {
    const token = body(options).token;
    const preview = previews.get(token);
    if (!preview || Date.now() - preview.createdAt > 15 * 60_000) throw new Error('预览已过期，请重新生成');
    previews.delete(token);
    return change((current) => {
      if (!currentDoc(current, preview.docId)) throw new Error('资料不存在');
      let note = current.notes.find((item) => item.docId === preview.docId && item.page === preview.page && item.kind === 'ai' && !item.deleted);
      if (!note) {
        note = { id: crypto.randomUUID(), docId: preview.docId, page: preview.page, order: 0, title: `第 ${preview.page} 页 · 智能笔记`, kind: 'ai', blocks: [], links: [], createdAt: new Date().toISOString(), deleted: false };
        current.notes.push(note);
      }
      note.ai = preview.ai;
      note.status = 'done';
      note.updatedAt = new Date().toISOString();
      return note;
    });
  }
  throw new Error('离线版暂不支持此操作');
}

async function saveBlob(filename, mime, blob) {
  if (window.YingxingAndroidDownload?.begin) {
    const bridge = window.YingxingAndroidDownload;
    bridge.begin(filename, mime);
    try {
      for (let start = 0; start < blob.size; start += 96 * 1024) {
        const bytes = new Uint8Array(await blob.slice(start, start + 96 * 1024).arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        bridge.chunk(btoa(binary));
      }
      bridge.finish();
    } catch (error) { bridge.cancel(); throw error; }
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export async function offlineBackup() {
  await writeQueue.catch(() => {});
  const current = await state();
  const files = { 'state.json': strToU8(JSON.stringify(current)) };
  for (const doc of current.docs) files[`documents/${doc.id}/preview.pdf`] = new Uint8Array(await offlinePdf(doc.id));
  const archive = zipSync(files, { level: 0 });
  await saveBlob(`源笔记备份-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip', new Blob([archive], { type: 'application/zip' }));
}

export async function offlineRestore(file) {
  if (!file || file.size > 250 * 1024 * 1024) throw new Error('备份文件不能超过 250 MB');
  let expandedSize = 0;
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter(entry) {
      expandedSize += entry.originalSize;
      if (!Number.isSafeInteger(expandedSize) || entry.originalSize > 100 * 1024 * 1024 || expandedSize > 300 * 1024 * 1024)
        throw new Error('备份解压后过大，无法在手机上安全恢复');
      return true;
    },
  });
  if (!archive['state.json']) throw new Error('备份中缺少 state.json');
  const restored = JSON.parse(strFromU8(archive['state.json']));
  if (!Array.isArray(restored.docs) || !Array.isArray(restored.notes) || !Array.isArray(restored.templates)) throw new Error('备份数据格式无效');
  if (restored.docs.length > 2000 || restored.notes.length > 100000 || restored.templates.length > 10000) throw new Error('备份内容超过支持范围');
  const pdfs = restored.docs.map((doc) => {
    if (!/^[0-9a-f-]{36}$/.test(doc.id)) throw new Error('备份中的资料编号无效');
    const pdf = archive[`documents/${doc.id}/preview.pdf`];
    if (!pdf || strFromU8(pdf.subarray(0, 5)) !== '%PDF-') throw new Error(`备份中缺少 ${doc.name} 的 PDF`);
    return [doc.id, new Blob([pdf], { type: 'application/pdf' })];
  });
  const imageUrls = new Map();
  for (const [path, bytes] of Object.entries(archive)) {
    const match = path.match(/^images\/([0-9a-f-]{36}\.(png|jpg|gif|webp))$/);
    if (match) {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      imageUrls.set(`/api/images/${match[1]}`, `data:image/${match[2] === 'jpg' ? 'jpeg' : match[2]};base64,${btoa(binary)}`);
    }
  }
  function replaceImages(value) {
    if (typeof value === 'string') return imageUrls.get(value) || value;
    if (Array.isArray(value)) return value.map(replaceImages);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceImages(item)]));
    return value;
  }
  const missingImages = new Set();
  function inspectImages(value) {
    if (typeof value === 'string') {
      if (value.startsWith('/api/images/') && !imageUrls.has(value)) missingImages.add(value);
    } else if (Array.isArray(value)) value.forEach(inspectImages);
    else if (value && typeof value === 'object') Object.values(value).forEach(inspectImages);
  }
  inspectImages(restored);
  if (missingImages.size) throw new Error('备份缺少部分笔记图片，无法完整恢复');
  const next = writeQueue.catch(() => {}).then(() => write(replaceImages(restored), pdfs, true));
  writeQueue = next;
  await next;
  return restored.docs.length;
}
