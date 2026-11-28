import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { runAssistantTask } from '../src/assistantRunner.js';
import { assistantContext, prepareAssistantTool } from '../src/assistantTools.js';

test('assistant performs a complete multi-step task through real model and document APIs and persists mixed content', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yuan-assistant-'));
  const docId = crypto.randomUUID();
  const initial = { docs: [{ id: docId, name: '测试资料', pages: 1, deleted: false }], notes: [], folders: [], templates: [] };
  await writeFile(path.join(directory, 'state.json'), JSON.stringify(initial));
  let modelCalls = 0, noteId, mapId;
  const mock = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); modelCalls++;
    const result = input.messages.at(-1).content;
    const observed = result.startsWith('工具执行结果') ? JSON.parse(result.slice(result.indexOf('：') + 1)).result : null;
    let turn;
    if (modelCalls === 1) turn = { reply: '创建文件夹', tool: { name: 'create_folder', args: { name: '复习资料' } } };
    if (modelCalls === 2) turn = { reply: '移动资料', tool: { name: 'update_document', args: { docId, changes: { folderId: observed.id } } } };
    if (modelCalls === 3) turn = { reply: '创建笔记', tool: { name: 'create_note', args: { docId, page: 1, title: '公式笔记', parts: [{ type: 'text', text: '文字保留' }, { type: 'formula', text: 'E=mc^2' }, { type: 'image', data: 'data:image/png;base64,YQ==', width: 50, align: 'right' }] } } };
    if (modelCalls === 4) turn = { reply: '添加原文批注', tool: { name: 'link_source', args: { noteId: observed.id, page: 1, quote: '能量守恒', annotations: [{ type: 'formula', text: 'E=mc^2' }] } } };
    if (modelCalls === 5) { noteId = observed.id; turn = { reply: '读取当前笔记', tool: { name: 'read_note', args: { noteId } } }; }
    if (modelCalls === 6) turn = { reply: '添加导图', tool: { name: 'append_content', args: { noteId, parts: [{ type: 'mindmap', nodes: [{ id: 'root', text: '中心主题', x: 0, y: 0, shape: 'rectangle' }], edges: [] }] } } };
    if (modelCalls === 7) turn = { reply: '确认导图编号', tool: { name: 'read_note', args: { noteId } } };
    if (modelCalls === 8) { mapId = observed.blocks.find(block => block.type === 'mindmap').id; turn = { reply: '局部编辑导图', tool: { name: 'edit_mindmap', args: { noteId, blockId: mapId, nodes: [{ id: 'root', bold: true, fill: '#ffeeaa' }, { id: 'other', text: '局部新节点123ABC', x: 1800, y: 900, shape: 'circle', fontSize: 20 }], edges: [{ id: 'link', from: 'root', to: 'other', text: '关系说明', arrow: true, dashed: true }] } } }; }
    if (modelCalls === 9) turn = { reply: '扩展并整理画布', tool: { name: 'configure_mindmap', args: { noteId, blockId: mapId, width: 6000, height: 5000, layout: 'down' } } };
    if (modelCalls === 10) turn = { reply: '准备导出', tool: { name: 'export_mindmap', args: { noteId, blockId: mapId, format: 'json' } } };
    if (modelCalls === 11) turn = { reply: '已完成整理和笔记创建。', tool: null };
    assert.ok(turn, 'runner must not make unexpected model calls');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(turn) } }] }));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', YINGXING_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(async () => { mock.close(); if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; } await rm(directory, { recursive: true, force: true }); });
  const base = await new Promise((resolve, reject) => {
    let output = ''; const timeout = setTimeout(() => reject(new Error('server timeout')), 15000);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } }); child.once('error', reject);
  });
  const api = async (route, options = {}) => {
    const response = await fetch(base + '/api' + route, { ...options, headers: { 'Content-Type': 'application/json' } });
    const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
  };
  const model = { endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: 'mock', key: 'test-key' };
  const events = [], downloads = [];
  const run = await runAssistantTask({ history: [{ role: 'user', content: '整理资料并创建含公式图片的笔记，关联原文' }], context: async () => assistantContext(await api('/state'), { docId, page: 1 }),
    ask: value => api('/assistant/turn', { method: 'POST', body: JSON.stringify({ ...model, ...value }) }), env: { api, model, download: (...args) => downloads.push(args) }, confirm: async () => true, emit: event => events.push(event), refresh: async () => {} });
  assert.equal(run.observations.length, 10); assert.equal(modelCalls, 11);
  assert.equal(events.filter(event => event.status === 'error').length, 0);
  const state = await api('/state');
  assert.equal(state.docs[0].folderId, state.folders[0].id);
  assert.match(JSON.stringify(state.notes[0].blocks), /文字保留/);
  assert.match(JSON.stringify(state.notes[0].blocks), /formulaInline/);
  assert.match(JSON.stringify(state.notes[0].blocks), /noteImage/);
  assert.equal(state.notes[0].links[0].annotations[0].type, 'formula');
  const map = state.notes[0].blocks.find(block => block.type === 'mindmap');
  assert.equal(map.width, 6000); assert.equal(map.height, 5000); assert.equal(map.nodes[0].fill, '#ffeeaa'); assert.equal(map.nodes[0].bold, true);
  assert.equal(map.nodes[1].fontSize, 20); assert.equal(map.edges[0].text, '关系说明'); assert.equal(map.edges[0].arrow, true); assert.equal(map.edges[0].dashed, true);
  assert.equal(downloads[0][0], 'mindmap'); assert.equal(downloads[0][2].format, 'json');
  const persisted = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  assert.deepEqual(persisted.notes[0].blocks, state.notes[0].blocks);
  const copy = await (await prepareAssistantTool({ name: 'duplicate_note', args: { noteId: state.notes[0].id } }, { api })).run();
  const copied = (await api('/state')).notes.find(note => note.id === copy.id);
  assert.deepEqual(copied.blocks, state.notes[0].blocks); assert.deepEqual(copied.links, state.notes[0].links);
});

test('adaptive API preview preserves old AI and personal work until explicit commit and never saves a failed plan', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yuan-adaptive-')); const docId = crypto.randomUUID();
  await writeFile(path.join(directory, 'state.json'), JSON.stringify({ docs: [{ id: docId, name: 'PDF', pages: 1, deleted: false }], notes: [], folders: [], templates: [] }));
  // Import a real one-page PDF so this test exercises page extraction before planning.
  let invalid = false, count = 0;
  const provider = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw); count++;
    assert.match(JSON.stringify(body.messages[1]), /Energy conservation/);
    const planning = body.messages[0].content.includes('结构规划师');
    const answer = planning ? { titles: invalid ? [] : ['能量守恒的含义', '学习时要检查的条件'] } : { sections: [{ content: '来自原文的具体解释' }, { content: '核对能量的条件' }] };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] }));
  }); await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', YINGXING_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(async () => { provider.close(); const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped; await rm(directory, { recursive: true, force: true }); });
  const base = await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(Error('server timeout')), 15000); child.stdout.on('data', chunk => { out += chunk; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } }); });
  const api = async (route, options = {}) => { const res = await fetch(base + '/api' + route, options); return { status: res.status, value: await res.json() }; };
  const form = new FormData(); form.append('file', new Blob([await readFile('tests/fixtures/energy.pdf')], { type: 'application/pdf' }), 'source.pdf');
  const imported = await api('/docs', { method: 'POST', body: form }); assert.equal(imported.status, 200);
  const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const input = { endpoint: `http://127.0.0.1:${provider.address().port}/v1`, model: 'mock', key: 'dummy', docId: imported.value.id, page: 1, mode: 'adaptive' };
  invalid = true; const bad = await api('/generate', post(input)); assert.equal(bad.status, 400); assert.equal(count, 1); assert.equal((await api('/state')).value.notes.length, 0);
  invalid = false; const made = await api('/generate', post(input)); assert.equal(made.status, 200); assert.equal(made.value.ai.organization.mode, 'adaptive');
  await api('/notes/' + made.value.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: [{ id: 'own', type: 'text', text: '个人推导保留' }] }) });
  const old = (await api('/state')).value.notes[0], preview = await api('/generate', post({ ...input, preview: true })); assert.equal(preview.status, 200); assert.deepEqual((await api('/state')).value.notes[0], old);
  const committed = await api('/generate/commit', post({ token: preview.value.token })); assert.equal(committed.status, 200); assert.notEqual(committed.value.id, old.id); assert.equal(committed.value.generationVersion, 2); assert.deepEqual((await api('/state')).value.notes.find(n => n.id === old.id), old);
  const parallel = await Promise.all([api('/generate', post(input)), api('/generate', post(input))]);
  assert.deepEqual(parallel.map(result => result.value.generationVersion).sort(), [3, 4]);
  assert.equal(new Set(parallel.map(result => result.value.id)).size, 2);
  const beforeFailure = (await api('/state')).value.notes; invalid = true;
  assert.equal((await api('/generate', post(input))).status, 400);
  assert.deepEqual((await api('/state')).value.notes, beforeFailure);
  invalid = false;
  await api('/notes/' + parallel[1].value.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deleted: true }) });
  const next = await api('/generate', post(input)); assert.equal(next.value.generationVersion, 5);
  const agentApi = async (route, options) => { const result = await api(route, { ...options, headers: { 'Content-Type': 'application/json' } }); if (result.status !== 200) throw Error(result.value.error); return result.value; };
  const agentEnv = { api: agentApi, model: { endpoint: input.endpoint, model: input.model, key: input.key } };
  const generate = { name: 'generate_notes', args: { docId: imported.value.id, pages: [1], mode: 'adaptive' } };
  const sixth = await (await prepareAssistantTool(generate, agentEnv)).run();
  const seventh = await (await prepareAssistantTool(generate, agentEnv)).run();
  assert.equal(sixth[0].note.generationVersion, 6); assert.equal(seventh[0].note.generationVersion, 7);

  assert.deepEqual((await api('/state')).value.notes.find(note => note.id === old.id), old);

});

test('real API resumes two screenshot failures, uses native repair and creates one coordinate-free map after all ten pages are read', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yuan-agent-dual-fix-'));
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '']; const kids = [];
  for (let page = 1; page <= 10; page++) { const id = objects.length + 1, stream = `BT /F1 14 Tf 40 740 Td (Page ${page}: signal model method and evidence) Tj ET\n`; kids.push(`${id} 0 R`); objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${id + 1} 0 R >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`); }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count 10 >>`; let pdf = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; }); const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  let wire = 0, docId, noteId;
  const graph = { type: 'mindmap', nodes: [{ id: 'root', text: '研究逻辑', x: -300, y: -100 }, { id: 'method', text: '信号建模与方法' }, { id: 'evidence', text: '实验依据与结论' }], edges: [{ id: 'rm', from: 'root', to: 'method' }, { id: 'me', from: 'method', to: 'evidence' }] };
  const provider = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c; const payload = JSON.parse(raw); wire++; const turn = (name, args) => ({ reply: '继续原任务', tool: { name, args } }); let response;
    if (wire === 1) response = { content: JSON.stringify(turn('read_pages', { docId, pages: [1,2,3,4,5] })) };
    if (wire === 2) response = { content: JSON.stringify(turn('read_pages', { docId, pages: [6,7,8,9,10] })) };
    if (wire === 3) response = { content: JSON.stringify(turn('read_note', { noteId })) };
    if (wire >= 4 && wire <= 6) response = { content: '{"reply":"新增导图","tool":' };
    if (wire === 7) { assert.match(JSON.stringify(payload.messages), /继续原任务，上一步未执行/); response = { content: '请继续' }; }
    if (wire === 8) { assert.equal(payload.tools[0].function.name, 'yuan_notes_action'); assert.ok(!JSON.stringify(payload.messages).includes('请继续"'), 'invalid draft must not be copied as successful context'); response = { content: null, tool_calls: [{ function: { name: 'yuan_notes_action', arguments: JSON.stringify(turn('append_content', { noteId, parts: [graph] })) } }] }; }
    if (wire === 9) response = { content: JSON.stringify(turn('append_content', { noteId, parts: [{ ...graph, nodes: graph.nodes.map(n => ({ ...n, x: 120, y: 240, shape: 'rectangle' })) }] })) };
    if (wire === 10) response = { content: JSON.stringify({ reply: '导图已保存一次，原笔记保留', tool: null }) };
    assert.ok(response); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: response.tool_calls ? 'tool_calls' : 'stop', message: response }] }));
  }); await new Promise(r => provider.listen(0, '127.0.0.1', r));
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', YINGXING_DATA_DIR: directory }, stdio: ['ignore','pipe','pipe'], windowsHide: true });
  t.after(async () => { provider.close(); const stopped = new Promise(r => child.once('exit', r)); child.kill(); await stopped; await rm(directory, { recursive: true, force: true }); });
  const base = await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(Error('server timeout')), 15000); child.stdout.on('data', c => { out += c; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } }); });
  let reads = 0, edits = 0;
  const api = async (route, options = {}) => { if (route.endsWith('/text')) reads++; if (route.startsWith('/notes/') && options.method === 'PUT') edits++; const r = await fetch(base + '/api' + route, { ...options, headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' } }); const value = await r.json(); if (!r.ok) throw Object.assign(Error(value.error), { code: value.code }); return value; };
  const form = new FormData(); form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'ten-pages.pdf'); const doc = await api('/docs', { method: 'POST', body: form }); docId = doc.id; assert.equal(doc.pages, 10);
  const ai = { sections: [{ title: '研究重点', content: '原有智能笔记，不应覆盖' }] }; const note = await api('/notes', { method: 'POST', body: JSON.stringify({ docId, page: 1, title: '第1页智能笔记', kind: 'ai', ai, blocks: [{ id: 'personal', type: 'text', text: '用户的手写推导说明' }] }) }); noteId = note.id;
  const model = { endpoint: `http://127.0.0.1:${provider.address().port}/v1`, model: 'mock', key: 'dummy' }; let saved;
  const settings = { history: [{ role: 'user', content: '读取全篇10页论文，在已有智能笔记下新增一张思维导图' }], context: async () => assistantContext(await api('/state'), { docId, page: 1, noteId }), env: { api }, ask: value => api('/assistant/turn', { method: 'POST', body: JSON.stringify({ ...model, ...value }) }), confirm: async () => true, emit: () => {}, refresh: async () => {}, onCheckpoint: value => saved = value };
  await assert.rejects(runAssistantTask(settings), e => e.code === 'ASSISTANT_FORMAT'); assert.equal(reads, 10); assert.equal(edits, 0); assert.equal(saved.observations.length, 3);
  const done = await runAssistantTask({ ...settings, state: saved }); assert.equal(wire, 10); assert.equal(reads, 10); assert.equal(edits, 1); assert.equal(done.observations.at(-1).ok, false);
  const persisted = (await api('/state')).notes.find(n => n.id === noteId); assert.deepEqual(persisted.ai, ai); assert.match(JSON.stringify(persisted.blocks), /用户的手写推导说明/); const maps = persisted.blocks.filter(b => b.type === 'mindmap'); assert.equal(maps.length, 1); assert.equal(maps[0].nodes.length, 3); assert.ok(maps[0].nodes.every(n => n.x >= 0 && n.y >= 0));
});
