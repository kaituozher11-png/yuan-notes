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
  let modelCalls = 0;
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
    if (modelCalls === 5) turn = { reply: '已完成整理和笔记创建。', tool: null };
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
  const events = [];
  const run = await runAssistantTask({ history: [{ role: 'user', content: '整理资料并创建含公式图片的笔记，关联原文' }], context: async () => assistantContext(await api('/state'), { docId, page: 1 }),
    ask: value => api('/assistant/turn', { method: 'POST', body: JSON.stringify({ ...model, ...value }) }), env: { api, model }, confirm: async () => true, emit: event => events.push(event), refresh: async () => {} });
  assert.equal(run.observations.length, 4); assert.equal(modelCalls, 5);
  assert.equal(events.filter(event => event.status === 'error').length, 0);
  const state = await api('/state');
  assert.equal(state.docs[0].folderId, state.folders[0].id);
  assert.match(JSON.stringify(state.notes[0].blocks), /文字保留/);
  assert.match(JSON.stringify(state.notes[0].blocks), /formulaInline/);
  assert.match(JSON.stringify(state.notes[0].blocks), /noteImage/);
  assert.equal(state.notes[0].links[0].annotations[0].type, 'formula');
  const persisted = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  assert.deepEqual(persisted.notes[0].blocks, state.notes[0].blocks);
  const copy = await (await prepareAssistantTool({ name: 'duplicate_note', args: { noteId: state.notes[0].id } }, { api })).run();
  const copied = (await api('/state')).notes.find(note => note.id === copy.id);
  assert.deepEqual(copied.blocks, state.notes[0].blocks); assert.deepEqual(copied.links, state.notes[0].links);
});
