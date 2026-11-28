import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

function samplePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 58 >>\nstream\nBT /F1 18 Tf 70 720 Td (Energy conservation rule) Tj ET\nendstream'
  ];
  let result = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((obj, index) => { offsets.push(Buffer.byteLength(result)); result += `${index + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) result += `${String(offset).padStart(10, '0')} 00000 n \n`;
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}

async function request(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, options);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

test('document and note API preserves personal work across generation', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yingxing-test-'));
  const port = await freePort();
  const processHandle = spawn(process.execPath, ['server/index.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), YINGXING_DATA_DIR: dir }, stdio: 'ignore' });
  t.after(async () => { processHandle.kill(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 150; i++) { try { if ((await request(base, '/api/health')).status === 200) { ready = true; break; } } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.ok(ready, 'API server started');
  for (const [name, bytes, message] of [
    ['empty.pdf', Buffer.alloc(0), /文件为空/],
    ['renamed.pdf', Buffer.from('This is not a PDF'), /不是有效的 PDF/],
    ['incomplete.pdf', Buffer.from('%PDF-1.7\ntruncated file without page objects'), /无法解析 PDF/],
    ['protected.pdf', await readFile('tests/fixtures/encrypted.pdf'), /需要密码/],
  ]) {
    const invalid = new FormData(); invalid.append('file', new Blob([bytes]), name);
    const result = await request(base, '/api/docs', { method: 'POST', body: invalid });
    assert.equal(result.status, 400); assert.match(result.data.error, message);
    assert.ok(!result.data.error.includes(dir), 'invalid-file messages must not expose internal storage paths');
  }
  assert.equal((await request(base, '/api/state')).data.docs.length, 0);
  assert.equal((await request(base, '/api/state', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    http.get(`${base}/api/state`, { headers: { Host: 'untrusted.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(wrongHostStatus, 403);

  const form = new FormData(); form.append('file', new Blob([samplePdf()], { type: 'application/pdf' }), 'energy.pdf'); form.append('course', 'Physics');
  const imported = await request(base, '/api/docs', { method: 'POST', body: form });
  assert.equal(imported.status, 200);
  assert.equal(imported.data.pages, 1);
  assert.equal(imported.data.course, 'Physics');
  assert.equal(imported.data.folderId, null);
  const jsonRequest = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const folder = await request(base, '/api/folders', jsonRequest('POST', { name: '论文' }));
  assert.equal(folder.status, 200);
  assert.equal((await request(base, '/api/folders', jsonRequest('POST', { name: ' 论文 ' }))).status, 400);
  assert.equal((await request(base, '/api/folders', jsonRequest('POST', { name: ' ' }))).status, 400);
  const otherFolder = await request(base, '/api/folders', jsonRequest('POST', { name: '课件' }));
  assert.equal((await request(base, `/api/folders/${folder.data.id}`, jsonRequest('PATCH', { name: '课件' }))).status, 400);
  const moved = await request(base, `/api/docs/${imported.data.id}`, jsonRequest('PATCH', { folderId: folder.data.id }));
  assert.equal(moved.data.folderId, folder.data.id);
  assert.equal((await request(base, `/api/folders/${folder.data.id}`, { method: 'DELETE' })).status, 400);
  assert.equal((await request(base, `/api/docs/${imported.data.id}`, jsonRequest('PATCH', { folderId: 'missing' }))).status, 400);
  const secondForm = new FormData(); secondForm.append('file', new Blob([samplePdf()], { type: 'application/pdf' }), 'second.pdf'); secondForm.append('folderId', folder.data.id);
  const secondImported = await request(base, '/api/docs', { method: 'POST', body: secondForm });
  assert.equal(secondImported.status, 200);
  assert.equal(secondImported.data.folderId, folder.data.id);
  const thirdForm = new FormData(); thirdForm.append('file', new Blob([samplePdf()], { type: 'application/pdf' }), 'third.pdf'); thirdForm.append('folderId', otherFolder.data.id);
  assert.equal((await request(base, '/api/docs', { method: 'POST', body: thirdForm })).status, 200);
  const invalidForm = new FormData(); invalidForm.append('file', new Blob([samplePdf()], { type: 'application/pdf' }), 'bad-folder.pdf'); invalidForm.append('folderId', 'missing');
  assert.equal((await request(base, '/api/docs', { method: 'POST', body: invalidForm })).status, 400);
  assert.equal((await request(base, `/api/docs/${secondImported.data.id}`, jsonRequest('PATCH', { folderId: null }))).data.folderId, null);
  assert.equal((await request(base, `/api/folders/${folder.data.id}`, jsonRequest('PATCH', { name: '研究论文' }))).data.name, '研究论文');
  assert.deepEqual((await request(base, '/api/state')).data.folders.map((item) => item.name), ['研究论文', '课件']);
  const chinese = new FormData(); chinese.append('file', new Blob([samplePdf()], { type: 'application/pdf' }), '雷达目标检测_陈垣光.pdf');
  const chineseImported = await request(base, '/api/docs', { method: 'POST', body: chinese });
  assert.equal(chineseImported.status, 200);
  assert.equal(chineseImported.data.filename, '雷达目标检测_陈垣光.pdf');
  assert.equal(chineseImported.data.name, '雷达目标检测_陈垣光');
  const docId = imported.data.id;
  const markup = { strokes: [
    { tool: 'pen', color: '#d64545', size: 3, points: [[.1, .2], [.4, .5]] },
    { tool: 'eraser', color: '#d64545', size: 18, points: [[.2, .3]] },
  ], stickies: [{ id: 'test-sticky', x: .2, y: .3, text: 'Remember this', collapsed: false }] };
  const markupOptions = (body) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.deepEqual((await request(base, `/api/docs/${docId}/pages/1/markup`, markupOptions(markup))).data, markup);
  assert.equal((await request(base, `/api/docs/${docId}/pages/2/markup`, markupOptions(markup))).status, 400);
  assert.equal((await request(base, `/api/docs/${docId}/pages/1/markup`, markupOptions({ ...markup, strokes: [{ ...markup.strokes[0], points: [[2, .5]] }] }))).status, 400);
  assert.deepEqual((await request(base, '/api/state')).data.docs.find((item) => item.id === docId).markup['1'], markup);
  const imageForm = new FormData();
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=', 'base64');
  imageForm.append('image', new Blob([imageBytes], { type: 'image/png' }), 'pixel.png');
  const image = await request(base, '/api/images', { method: 'POST', body: imageForm });
  assert.equal(image.status, 200);
  assert.equal((await fetch(`${base}${image.data.url}`)).status, 200);
  const wrongImage = new FormData(); wrongImage.append('image', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'bad.svg');
  assert.equal((await request(base, '/api/images', { method: 'POST', body: wrongImage })).status, 400);
  const text = await request(base, `/api/docs/${docId}/pages/1/text`);
  assert.match(text.data.text, /Energy conservation rule/);
  assert.equal((await request(base, `/api/docs/${docId}/pages/2/text`)).status, 404);

  const bad = new FormData(); bad.append('file', new Blob(['no']), 'bad.txt');
  assert.equal((await request(base, '/api/docs', { method: 'POST', body: bad })).status, 400);
  const created = await request(base, '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId, page: 1, title: 'My notes' }) });
  assert.equal(created.status, 200);
  const block = { id: 'personal', type: 'text', text: 'My own explanation' };
  const saved = await request(base, `/api/notes/${created.data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: [block] }) });
  assert.deepEqual(saved.data.blocks, [block]);
  const mixed = { id: 'mixed', type: 'mixed', parts: [
    { id: 'intro', type: 'text', text: '先看这张图' },
    { id: 'figure', type: 'image', data: image.data.url, text: '示意图' },
    { id: 'equation', type: 'formula', text: 'E=mc^2' },
    { id: 'drawing', type: 'drawing', height: 900, strokes: [{ tool: 'pen', color: '#176d72', size: 3, points: [[10, 450], [20, 470]] }] },
    { id: 'outro', type: 'text', text: '然后记住结论' },
  ] };
  const mixedSaved = await request(base, `/api/notes/${created.data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: [block, mixed] }) });
  assert.deepEqual(mixedSaved.data.blocks[1], mixed);
  const sourceLink = { id: 'source-link', page: 1, quote: 'Energy conservation rule', rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }], annotations: [
    { id: 'text-comment', type: 'text', text: 'Important principle' },
    { id: 'formula-comment', type: 'formula', text: 'E = mc^2' },
    { id: 'image-comment', type: 'image', data: image.data.url, text: 'Diagram' }
  ] };
  const linked = await request(base, `/api/notes/${created.data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links: [sourceLink] }) });
  assert.deepEqual(linked.data.links, [sourceLink]);
  const movedLink = { ...sourceLink, rect: { x: .2, y: .3, width: .25, height: .1 }, rects: [{ x: .2, y: .3, width: .25, height: .1 }] };
  const regionSaved = await request(base, `/api/notes/${created.data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links: [movedLink] }) });
  assert.deepEqual(regionSaved.data.links, [movedLink]);
  assert.equal((await request(base, `/api/notes/${created.data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deleted: true }) })).data.deleted, true);
  assert.equal((await request(base, `/api/notes/${created.data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deleted: false }) })).data.deleted, false);
  assert.equal((await request(base, '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId, page: 2 }) })).status, 400);

  let receivedImage = false;
  const modelServer = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    receivedImage = !!body.messages[1].content.find((part) => part.type === 'image_url')?.image_url.url.startsWith('data:image/jpeg;base64,');
    res.setHeader('content-type', 'application/json');
    const answer = body.messages[0].content.includes('"sections"')
      ? { sections: [{ title: 'model title', content: 'Research question' }, { content: 'Result from page' }] }
      : { summary: 'Energy is conserved.', concepts: [], important: [], cautions: [], formula: [], quiz: [], evidence: [{ quote: 'Energy conservation rule', note: 'title' }] };
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
  });
  await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  t.after(() => modelServer.close());
  const model = { docId, page: 1, endpoint: `http://127.0.0.1:${modelServer.address().port}/v1`, key: 'test-key', model: 'test', vision: true };
  const options = (payload) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const generated = await request(base, '/api/generate', options(model));
  assert.equal(generated.status, 200);
  assert.ok(receivedImage);
  assert.equal(generated.data.ai.evidence, undefined);
  assert.equal(generated.data.status, 'done');
  const second = await request(base, '/api/generate', options(model));
  assert.equal(second.status, 200); assert.equal(second.data.generationVersion, 2); assert.notEqual(second.data.id, generated.data.id);
  const preview = await request(base, '/api/generate', options({ ...model, preview: true }));
  assert.equal(preview.status, 200);
  assert.equal(preview.data.previous.summary, 'Energy is conserved.');
  assert.equal((await request(base, '/api/generate/commit', options({ token: preview.data.token }))).status, 200);
  assert.equal((await request(base, '/api/generate/commit', options({ token: preview.data.token }))).status, 410);
  const outline = ['研究背景', '我的结论'];
  const customPreview = await request(base, '/api/generate', options({ ...model, outline, guidance: '突出公式', preview: true }));
  assert.equal(customPreview.status, 200);
  assert.equal(customPreview.data.previous.summary, 'Energy is conserved.');
  assert.deepEqual(customPreview.data.ai.sections.map((section) => section.title), outline);
  const committed = await request(base, '/api/generate/commit', options({ token: customPreview.data.token }));
  assert.equal(committed.status, 200);
  assert.deepEqual(committed.data.ai.sections.map((section) => section.title), outline);
  assert.equal((await request(base, '/api/generate', options({ ...model, outline: [''], preview: true }))).status, 400);
  const state = (await request(base, '/api/state')).data;
  assert.equal(state.notes.find((n) => n.id === created.data.id).blocks[0].text, 'My own explanation');
  assert.deepEqual(state.notes.find((n) => n.id === created.data.id).blocks[1], mixed);
  assert.deepEqual(state.notes.find((n) => n.id === created.data.id).links, [movedLink]);
  assert.equal(state.notes.filter((n) => n.kind === 'ai').length, 4);
  assert.deepEqual(state.notes.filter(n => n.kind === 'ai').map(n => n.generationVersion), [1, 2, 3, 4]);
  assert.deepEqual(state.notes.find(n => n.id === generated.data.id).ai, generated.data.ai);
  const aiId = state.notes.find((n) => n.kind === 'ai').id;
  const reordered = await request(base, '/api/notes/reorder', options({ ids: [created.data.id, ...state.notes.filter(n => n.kind === 'ai').map(n => n.id)] }));
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.data.map((n) => n.order), [1, 2, 3, 4, 5]);
  assert.equal((await request(base, '/api/notes/reorder', options({ ids: [aiId, aiId] }))).status, 400);
  assert.equal((await readFile(path.join(dir, 'state.json'), 'utf8')).includes('test-key'), false);
  const backup = await fetch(`${base}/api/backup`);
  assert.equal(backup.status, 200);
  assert.equal(backup.headers.get('content-type'), 'application/zip');
  const bytes = new Uint8Array(await backup.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4]);
  assert.ok(Buffer.from(bytes).includes(Buffer.from(`images/${image.data.url.split('/').at(-1)}`)));
});
