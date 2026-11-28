import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { ZipFile } from 'yazl';
import { dataDir, getDataDir, currentUserId, runForUser, clearUserState, getState, mutate } from './store.js';
import { importDocument, pdfPath, pageText } from './documents.js';
import { callAssistant, callModel, generatePage } from './agent.js';
import { validateMarkup } from './markup.js';
import { createAuth } from './auth.js';
import { createFolder, folderName, folderTarget } from '../src/libraryFolders.js';
import { appendGeneratedNote } from '../src/aiNoteVersions.js';

const app = express();
app.disable('x-powered-by');
const publicMode = process.env.YINGXING_PUBLIC === '1';
app.set('trust proxy', publicMode && process.env.YINGXING_TRUST_PROXY === '1' ? 1 : false);
const configuredOrigin = publicMode ? new URL(process.env.YINGXING_PUBLIC_ORIGIN || '') : null;
const lanAddress = configuredOrigin?.hostname;
const lanParts = lanAddress?.split('.').map(Number) || [];
const privateLan = net.isIP(lanAddress) === 4 && (
  lanParts[0] === 10 ||
  (lanParts[0] === 172 && lanParts[1] >= 16 && lanParts[1] <= 31) ||
  (lanParts[0] === 192 && lanParts[1] === 168)
);
const allowLanHttp = process.env.YINGXING_LAN_TEST === '1' && privateLan && process.env.YINGXING_BIND_HOST === lanAddress;
const lanTls = Boolean(process.env.YINGXING_TLS_KEY || process.env.YINGXING_TLS_CERT);
if (lanTls && (!allowLanHttp || configuredOrigin.protocol !== 'https:' || !process.env.YINGXING_TLS_KEY || !process.env.YINGXING_TLS_CERT)) {
  throw new Error('局域网 HTTPS 测试必须使用匹配的私有地址、证书和密钥');
}
if (publicMode && (
  configuredOrigin.username || configuredOrigin.password || configuredOrigin.pathname !== '/' ||
  !['https:', 'http:'].includes(configuredOrigin.protocol) ||
  (configuredOrigin.protocol !== 'https:' && !allowLanHttp && !(process.env.YINGXING_PUBLIC_ALLOW_HTTP === '1' && ['localhost', '127.0.0.1'].includes(configuredOrigin.hostname)))
)) throw new Error('公开模式必须配置 HTTPS 网站地址；HTTP 仅可用于明确启用的本机或局域网测试');
const publicOrigin = configuredOrigin?.origin;
const auth = publicMode ? await createAuth(dataDir, configuredOrigin.protocol === 'https:') : null;
const authAttempts = new Map();

app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use('/api', (req, res, next) => {
  const host = req.headers.host?.split(':')[0]?.toLowerCase();
  if (publicMode) {
    if (req.headers.host?.toLowerCase() !== configuredOrigin.host.toLowerCase()) return res.status(403).json({ error: '网站地址无效' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: '不允许跨网站访问' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-yingxing-request'] !== '1') return res.status(403).json({ error: '请求验证失败' });
  } else if (!['127.0.0.1', 'localhost'].includes(host)) return res.status(403).json({ error: '只允许本机访问' });
  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      if (publicMode ? url.origin !== publicOrigin : !['127.0.0.1', 'localhost'].includes(url.hostname)) return res.status(403).json({ error: '不允许来自其他网站的请求' });
    } catch { return res.status(403).json({ error: '请求来源无效' }); }
  }
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '12mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const error = (res, err) => res.status(400).json({ error: err.message || '操作失败', ...(['ASSISTANT_FORMAT', 'ASSISTANT_TRUNCATED'].includes(err.code) ? { code: err.code } : {}) });
const currentDoc = (state, id) => state.docs.find((doc) => doc.id === id && !doc.deleted);
const pendingPreviews = new Map();

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/auth/session', (req, res) => res.json({ mode: publicMode ? 'public' : 'local', user: auth?.session(req) || null }));

function limitAuth(req, res, next) {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress;
  const username = String(req.body?.username || '').toLowerCase().slice(0, 32);
  const limits = [
    [`${req.path}:ip:${ip}`, req.path.endsWith('/register') ? 30 : 120],
    [`${req.path}:account:${ip}:${username}`, 15],
  ];
  if (authAttempts.size > 10000) {
    for (const [key, record] of authAttempts) if (now - record.since > 15 * 60_000) authAttempts.delete(key);
  }
  let blocked = false;
  for (const [key, max] of limits) {
    const record = authAttempts.get(key);
    const nextRecord = !record || now - record.since > 15 * 60_000 ? { since: now, count: 1 } : { since: record.since, count: record.count + 1 };
    authAttempts.set(key, nextRecord);
    if (nextRecord.count > max) blocked = true;
  }
  if (blocked) return res.status(429).json({ error: '尝试次数过多，请稍后再试' });
  next();
}

app.post('/api/auth/register', limitAuth, async (req, res) => {
  if (!publicMode) return res.sendStatus(404);
  try { res.json(await auth.register(req.body || {}, res)); }
  catch (err) { error(res, err); }
});
app.post('/api/auth/login', limitAuth, async (req, res) => {
  if (!publicMode) return res.sendStatus(404);
  try { res.json(await auth.login(req.body || {}, res)); }
  catch (err) { error(res, err); }
});
app.post('/api/auth/recover', limitAuth, async (req, res) => {
  if (!publicMode) return res.sendStatus(404);
  try { res.json(await auth.recover(req.body || {}, res)); }
  catch (err) { error(res, err); }
});
app.post('/api/auth/logout', (req, res) => {
  if (!publicMode) return res.sendStatus(404);
  auth.logout(req, res);
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (!publicMode) return next();
  const user = auth.session(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  req.user = user;
  runForUser(user.id, next);
});

app.delete('/api/auth/account', async (req, res) => {
  try {
    const user = await auth.deleteAccount(req.user.id, req.body?.password, req, res);
    clearUserState(user.id);
    await fs.rm(path.join(dataDir, 'users', user.id), { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) { error(res, err); }
});
app.get('/api/state', async (_req, res) => res.json(await getState()));
app.post('/api/folders', async (req, res) => {
  try { res.json(await mutate((state) => createFolder(state, req.body.name))); }
  catch (err) { error(res, err); }
});
app.patch('/api/folders/:id', async (req, res) => {
  try {
    res.json(await mutate((state) => {
      const folder = state.folders.find((item) => item.id === req.params.id);
      if (!folder) throw new Error('文件夹不存在');
      const name = folderName(req.body.name);
      if (state.folders.some((item) => item.id !== folder.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('文件夹名称已存在');
      folder.name = name;
      return folder;
    }));
  } catch (err) { error(res, err); }
});
app.delete('/api/folders/:id', async (req, res) => {
  try {
    res.json(await mutate((state) => {
      if (!state.folders.some((item) => item.id === req.params.id)) throw new Error('文件夹不存在');
      if (state.docs.some((doc) => !doc.deleted && doc.folderId === req.params.id)) throw new Error('请先移出文件夹中的资料');
      for (const doc of state.docs) if (doc.folderId === req.params.id) doc.folderId = null;
      state.folders = state.folders.filter((folder) => folder.id !== req.params.id);
      return { ok: true };
    }));
  } catch (err) { error(res, err); }
});
app.post('/api/images', imageUpload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) throw new Error('请选择图片');
    const formats = [{ type: 'image/png', ext: '.png', magic: [0x89, 0x50, 0x4e, 0x47] }, { type: 'image/jpeg', ext: '.jpg', magic: [0xff, 0xd8, 0xff] }, { type: 'image/gif', ext: '.gif', magic: [0x47, 0x49, 0x46] }, { type: 'image/webp', ext: '.webp', magic: [0x52, 0x49, 0x46, 0x46] }];
    const format = formats.find((item) => item.type === file.mimetype && item.magic.every((byte, index) => file.buffer[index] === byte));
    if (!format) throw new Error('仅支持 PNG、JPEG、GIF 或 WebP 图片');
    const name = `${crypto.randomUUID()}${format.ext}`;
    const dir = path.join(getDataDir(), 'images'); await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), file.buffer);
    res.json({ url: `/api/images/${name}` });
  } catch (err) { error(res, err); }
});
app.get('/api/images/:name', async (req, res) => {
  if (!/^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(req.params.name)) return res.sendStatus(404);
  res.sendFile(path.join(getDataDir(), 'images', req.params.name), (err) => { if (err && !res.headersSent) res.sendStatus(404); });
});
app.get('/api/backup', async (_req, res) => {
  try {
    await getState();
    const directory = getDataDir();
    const zip = new ZipFile();
    async function addDirectory(dir) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await addDirectory(full);
        else if (entry.isFile() && !entry.name.endsWith('.tmp')) zip.addFile(full, path.relative(directory, full).replaceAll('\\', '/'));
      }
    }
    await addDirectory(directory);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="yingxing-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
    zip.outputStream.on('error', () => res.destroy());
    zip.outputStream.pipe(res);
    zip.end();
  } catch (err) { error(res, err); }
});
app.post('/api/docs', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('请选择文件');
    const folderId = folderTarget(await getState(), req.body.folderId);
    const doc = await importDocument(req.file);
    doc.course = String(req.body.course || '').trim().slice(0, 100);
    await mutate((s) => { doc.folderId = folderTarget(s, folderId); s.docs.unshift(doc); });
    res.json(doc);
  } catch (err) { error(res, err); }
});
app.get('/api/docs/:id/pdf', async (req, res) => {
  const s = await getState(); const doc = currentDoc(s, req.params.id);
  if (!doc) return res.sendStatus(404);
  res.type('pdf').sendFile(pdfPath(doc.id));
});
app.get('/api/docs/:id/pages/:page/text', async (req, res) => {
  try {
    const s = await getState(); const doc = currentDoc(s, req.params.id); const page = Number(req.params.page);
    if (!doc || !Number.isInteger(page) || page < 1 || page > doc.pages) return res.sendStatus(404);
    res.json({ text: await pageText(doc.id, page) });
  } catch (err) { error(res, err); }
});
app.put('/api/docs/:id/pages/:page/markup', async (req, res) => {
  try {
    const markup = validateMarkup(req.body);
    const saved = await mutate((s) => {
      const doc = currentDoc(s, req.params.id);
      const page = Number(req.params.page);
      if (!doc || !Number.isInteger(page) || page < 1 || page > doc.pages) throw new Error('原文页不存在');
      doc.markup ||= {};
      doc.markup[page] = markup;
      doc.updatedAt = new Date().toISOString();
      return markup;
    });
    res.json(saved);
  } catch (err) { error(res, err); }
});
app.patch('/api/docs/:id', async (req, res) => {
  try {
    const doc = await mutate((s) => {
      const item = s.docs.find((d) => d.id === req.params.id); if (!item) throw new Error('资料不存在');
      if (typeof req.body.deleted === 'boolean') item.deleted = req.body.deleted;
      if (typeof req.body.name === 'string') item.name = req.body.name.trim().slice(0, 150) || item.name;
      if (typeof req.body.course === 'string') item.course = req.body.course.trim().slice(0, 100);
      if ('folderId' in req.body) item.folderId = folderTarget(s, req.body.folderId);
      item.updatedAt = new Date().toISOString(); return item;
    }); res.json(doc);
  } catch (err) { error(res, err); }
});
app.post('/api/notes', async (req, res) => {
  try {
    const note = await mutate((s) => {
      const doc = currentDoc(s, req.body.docId); const page = Number(req.body.page);
      if (!doc || !Number.isInteger(page) || page < 1 || page > doc.pages) throw new Error('原文页不存在');
      const order = Math.max(0, ...s.notes.filter((n) => n.docId === doc.id && n.page === page && !n.deleted).map((n) => Number(n.order || 0))) + 1;
      const note = { id: crypto.randomUUID(), docId: doc.id, page, order, title: String(req.body.title || '我的补充').slice(0, 100), kind: req.body.kind === 'ai' ? 'ai' : 'user', ai: req.body.ai || null, blocks: Array.isArray(req.body.blocks) ? req.body.blocks : [], links: Array.isArray(req.body.links) ? req.body.links : [], ...(req.body.style ? { style: req.body.style } : {}), status: 'new', deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      s.notes.push(note); return note;
    }); res.json(note);
  } catch (err) { error(res, err); }
});
app.put('/api/notes/:id', async (req, res) => {
  try {
    const note = await mutate((s) => {
      const item = s.notes.find((n) => n.id === req.params.id); if (!item) throw new Error('笔记不存在');
      for (const field of ['title', 'ai', 'blocks', 'links', 'status', 'deleted', 'style']) if (field in req.body) item[field] = req.body[field];
      item.updatedAt = new Date().toISOString(); return item;
    }); res.json(note);
  } catch (err) { error(res, err); }
});
app.post('/api/notes/reorder', async (req, res) => {
  try {
    const ordered = await mutate((s) => {
      const ids = req.body.ids;
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('笔记顺序无效');
      const notes = ids.map((id) => s.notes.find((n) => n.id === id && !n.deleted));
      if (notes.some((n) => !n) || notes.some((n) => n.docId !== notes[0].docId || n.page !== notes[0].page)) throw new Error('只能调整同一页的笔记');
      const all = s.notes.filter((n) => n.docId === notes[0].docId && n.page === notes[0].page && !n.deleted);
      if (all.length !== ids.length) throw new Error('笔记列表已更新，请刷新后重试');
      notes.forEach((note, index) => { note.order = index + 1; note.updatedAt = new Date().toISOString(); });
      return notes;
    }); res.json(ordered);
  } catch (err) { error(res, err); }
});
app.post('/api/templates', async (req, res) => {
  try { const template = await mutate((s) => { const item = { id: crypto.randomUUID(), name: String(req.body.name || '新模板').slice(0, 80), sections: req.body.sections || ['课堂重点', '我的疑问'], style: req.body.style || { accent: '#176d72', paper: 'plain' }, createdAt: new Date().toISOString() }; s.templates.push(item); return item; }); res.json(template); }
  catch (err) { error(res, err); }
});
app.put('/api/templates/:id', async (req, res) => {
  try { const template = await mutate((s) => { const item = s.templates.find((t) => t.id === req.params.id); if (!item) throw new Error('模板不存在'); item.name = String(req.body.name || item.name).slice(0, 80); item.sections = Array.isArray(req.body.sections) ? req.body.sections.map((v) => String(v).slice(0, 80)) : item.sections; if (req.body.style) item.style = req.body.style; return item; }); res.json(template); }
  catch (err) { error(res, err); }
});
app.delete('/api/templates/:id', async (req, res) => { await mutate((s) => { s.templates = s.templates.filter((t) => t.id !== req.params.id); }); res.json({ ok: true }); });
app.post('/api/models/test', async (req, res) => { try { res.json(await callModel({ ...req.body, test: true })); } catch (err) { error(res, err); } });
app.post('/api/assistant/turn', async (req, res) => {
  const controller = new AbortController();
  const disconnected = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', disconnected);
  try { res.json(await callAssistant({ ...req.body, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]) })); }
  catch (err) { if (!controller.signal.aborted) error(res, err); }
  finally { res.off('close', disconnected); }
});
app.post('/api/generate', async (req, res) => {
  const controller = new AbortController();
  const disconnected = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', disconnected);
  try {
    const s = await getState(); const doc = currentDoc(s, req.body.docId); const page = Number(req.body.page);
    if (!doc || !Number.isInteger(page) || page < 1 || page > doc.pages) return res.status(404).json({ error: '原文页不存在' });
    const existing = s.notes.filter((n) => n.docId === doc.id && n.page === page && n.kind === 'ai' && !n.deleted).at(-1);
    const ai = await generatePage({ ...req.body, page, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(req.body.mode === 'adaptive' ? 240000 : 120000)]) });
    controller.signal.throwIfAborted();
    if (req.body.preview) {
      const token = crypto.randomUUID();
      pendingPreviews.set(token, { userId: currentUserId(), docId: doc.id, page, ai, createdAt: Date.now() });
      return res.json({ token, ai, previous: existing?.ai || null });
    }
    const note = await mutate(state => appendGeneratedNote(state, { docId: doc.id, page, ai }));
    res.json(note);
  } catch (err) { if (!controller.signal.aborted) error(res, err); }
  finally { res.off('close', disconnected); }
});
app.post('/api/generate/commit', async (req, res) => {
  const candidate = pendingPreviews.get(req.body.token);
  if (!candidate || candidate.userId !== currentUserId() || Date.now() - candidate.createdAt > 15 * 60_000) return res.status(410).json({ error: '预览已过期，请重新生成' });
  pendingPreviews.delete(req.body.token);
  try {
    const note = await mutate(state => appendGeneratedNote(state, candidate));
    res.json(note);
  } catch (err) { error(res, err); }
});

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (publicMode) app.get('/offline.html', (_req, res) => res.sendStatus(404));
app.use(express.static(dist));
app.get('/{*splat}', async (_req, res) => { try { await fs.access(path.join(dist, 'index.html')); res.sendFile(path.join(dist, 'index.html')); } catch { res.sendStatus(404); } });
app.use((err, _req, res, _next) => res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 100 MB' : '服务暂时不可用' }));
const port = Number(process.env.PORT || 4174);
const bindHost = process.env.YINGXING_BIND_HOST || '127.0.0.1';
if (!publicMode && !['127.0.0.1', 'localhost'].includes(bindHost)) throw new Error('本机模式不能监听公网地址');
const server = lanTls ? https.createServer({
  key: await fs.readFile(process.env.YINGXING_TLS_KEY),
  cert: await fs.readFile(process.env.YINGXING_TLS_CERT),
}, app) : app;
const listener = server.listen(port, bindHost, () => console.log(`Yingxing API listening on ${lanTls ? 'https' : 'http'}://${bindHost}:${listener.address().port}`));
