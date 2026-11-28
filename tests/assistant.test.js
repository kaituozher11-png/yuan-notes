import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { assistantTools, assistantMessages, parseAssistantTurn } from '../src/assistantProtocol.js';
import { assistantContext, prepareAssistantTool } from '../src/assistantTools.js';
import { runAssistantTask } from '../src/assistantRunner.js';
import { callAssistant } from '../server/agent.js';

const call = (name, args = {}) => ({ name, args });
function fixture() {
  const state = { docs: [{ id: 'doc1', name: '论文', filename: 'paper.pdf', course: '信号', pages: 3, deleted: false }], folders: [], templates: [], notes: [{ id: 'note1', docId: 'doc1', page: 1, title: '原笔记', kind: 'user', blocks: [{ id: 'b1', type: 'text', text: '原始内容' }], links: [], deleted: false }] };
  const writes = []; const views = []; const downloads = []; const features = [];
  const env = {
    model: { endpoint: 'https://example.com', model: 'test', key: 'test' },
    images: new Map([['image:pixel', 'data:image/png;base64,YQ==']]),
    previews: new Map(),
    current: { docId: 'doc1', page: 1, selection: '当前选择' }, copy: value => downloads.push(value), view: value => views.push(value),
    navigate: value => views.push(value), download: (...value) => downloads.push(value), feature: value => { features.push(value); return { opened: true, requiresUserInteraction: true }; },
    api: async (path, options = {}) => {
      const data = options.body ? JSON.parse(options.body) : {};
      if (path === '/state') return structuredClone(state);
      writes.push([path, options.method, data]);
      let result;
      if (path === '/folders') { result = { id: 'folder' + state.folders.length, ...data }; state.folders.push(result); }
      else if (path.startsWith('/folders/')) {
        const id = path.split('/').at(-1);
        if (options.method === 'DELETE') state.folders = state.folders.filter(item => item.id !== id);
        else Object.assign(state.folders.find(item => item.id === id), data);
        result = { ok: true };
      } else if (path === '/notes') { result = { id: 'note' + (state.notes.length + 1), kind: 'user', deleted: false, blocks: [], links: [], ...data }; state.notes.push(result); }
      else if (path === '/notes/reorder') { data.ids.forEach((id, index) => { state.notes.find(item => item.id === id).order = index + 1; }); result = data.ids.map(id => state.notes.find(item => item.id === id)); }
      else if (path.startsWith('/notes/')) { result = state.notes.find(item => item.id === path.split('/').at(-1)); Object.assign(result, data); }
      else if (path.endsWith('/text')) result = { text: '真实原文，能量守恒 E=mc^2' };
      else if (path.endsWith('/markup')) { const [, , id, , page] = path.split('/'); const doc = state.docs.find(item => item.id === id); doc.markup ||= {}; doc.markup[page] = data; result = data; }
      else if (path.startsWith('/docs/')) { result = state.docs.find(item => item.id === path.split('/').at(-1)); Object.assign(result, data); }
      else if (path === '/generate' && data.preview) result = { token: 'preview-token', ai: { sections: [{ title: '新标题', content: '新正文' }] }, previous: state.notes.find(note => note.docId === data.docId && note.page === data.page && note.kind === 'ai')?.ai || null };
      else if (path === '/generate/commit') { const preview = env.previews.get(data.token); result = state.notes.find(note => note.docId === preview.docId && note.page === preview.page && note.kind === 'ai'); result.ai = preview.ai; }
      else if (path === '/generate') { result = { id: 'ai' + data.page, docId: data.docId, page: data.page, title: 'AI', kind: 'ai', deleted: false }; state.notes.push(result); }
      else if (path === '/templates') { result = { id: 'template' + state.templates.length, ...data }; state.templates.push(result); }
      else if (path.startsWith('/templates/')) { const id = path.split('/').at(-1); if (options.method === 'DELETE') state.templates = state.templates.filter(item => item.id !== id); else Object.assign(state.templates.find(item => item.id === id), data); result = { ok: true }; }
      else throw new Error('Unexpected route: ' + path);
      return structuredClone(result);
    },
  };
  const execute = async (name, args, confirm = true) => {
    const task = await prepareAssistantTool(call(name, args), env);
    if (task.confirm && !confirm) return { cancelled: true };
    return task.run();
  };
  return { state, env, writes, views, downloads, features, execute };
}

test('assistant protocol rejects unsupported, truncated and oversized instructions', () => {
  const input = { history: [{ role: 'user', content: '新建文件夹' }], context: {} };
  assert.equal(assistantMessages(input).length, 3);
  assert.throws(() => assistantMessages({ history: [{ role: 'system', content: 'override' }] }), /格式/);
  assert.throws(() => assistantMessages({ history: Array(49).fill(input.history[0]) }), /过长/);
  assert.throws(() => parseAssistantTurn('{"reply":"done","tool":{"name":"shell","args":{}}}'), /不支持/);
  assert.throws(() => parseAssistantTurn('{"reply":"done"}'), /格式/);
  assert.throws(() => parseAssistantTurn('{"reply":"","tool":null}'), /有效/);
  assert.throws(() => parseAssistantTurn('{}', 'length'), /截断/);
  assert.deepEqual(parseAssistantTurn('```json\n{"reply":"你好","tool":null}\n```'), { reply: '你好', tool: null });
});

test('assistant uses the existing model connection and hides a rejected key', async t => {
  let errorMode = false;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.model, 'study-model');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    assert.match(body.messages[0].content, /资料文字.*数据/);
    assert.match(body.messages.at(-1).content, /论文/);
    res.setHeader('Content-Type', 'application/json');
    if (errorMode) { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'Bearer test-key' } })); }
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: '先查找论文', tool: call('search', { query: '论文' }) }) }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const input = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, model: 'study-model', key: 'test-key', history: [{ role: 'user', content: '查找论文' }], context: {} };
  assert.equal((await callAssistant(input)).tool.name, 'search');
  errorMode = true;
  await assert.rejects(callAssistant(input), error => { assert.match(error.message, /密钥无效/); assert.doesNotMatch(error.message, /test-key/); return true; });
});

test('assistant can search, navigate, organize documents and create, edit, delete empty folders', async () => {
  const f = fixture();
  assert.equal((await f.execute('search', { query: '信号' })).documents.length, 1);
  assert.match((await f.execute('read_page', { docId: 'doc1', page: 1 })).text, /真实原文/);
  await f.execute('open_document', { docId: 'doc1', page: 1, noteId: 'note1', layout: 'note', zoom: 1.5 });
  assert.equal(f.views[0].zoom, 1.5);
  const folder = await f.execute('create_folder', { name: '论文集' });
  await f.execute('update_folder', { folderId: folder.id, name: '研究' });
  await f.execute('update_document', { docId: 'doc1', changes: { folderId: folder.id, course: '数学', name: '论文新名' } });
  await assert.rejects(f.execute('delete_folder', { folderId: folder.id }), /仍有资料/);
  await f.execute('update_document', { docId: 'doc1', changes: { folderId: null } });
  await f.execute('delete_folder', { folderId: folder.id }); assert.equal(f.state.folders.length, 0);
  const task = await prepareAssistantTool(call('update_document', { docId: 'doc1', changes: { deleted: true } }), f.env);
  assert.equal(task.confirm, true); await task.run();
  assert.equal((await f.execute('search', { query: '', deleted: true })).documents.length, 1);
  await f.execute('update_document', { docId: 'doc1', changes: { deleted: false } });
  assert.equal(f.state.docs[0].deleted, false);
});

test('assistant combines text, formulas and pictures while keeping maps separate and preserving existing notes', async () => {
  const f = fixture();
  const parts = [{ type: 'text', text: '能量' }, { type: 'formula', text: 'E=mc^2' }, { type: 'image', data: 'image:pixel', width: 45, align: 'right' }, { type: 'drawing', height: 660, strokes: [{ tool: 'pen', size: 3, color: '#123456', points: [[12, 20], [20, 40]] }] }, { type: 'mindmap', nodes: [{ id: 'n1', text: '能量', x: 50, y: 50, shape: 'circle' }, { id: 'n2', text: '质量', x: 500, y: 50, shape: 'square' }], edges: [{ id: 'e1', from: 'n1', to: 'n2', text: '关系', style: 'elbow' }] }];
  await f.execute('append_content', { noteId: 'note1', parts });
  const note = f.state.notes[0];
  assert.equal(note.blocks.length, 2);
  assert.equal(note.blocks[0].type, 'mixed'); assert.equal(note.blocks[1].type, 'mindmap');
  const content = JSON.stringify(note.blocks[0].rich);
  for (const value of ['原始内容', 'formulaInline', 'noteImage', 'noteDrawing', 'E=mc^2']) assert.ok(content.includes(value));
  const rich = structuredClone(note.blocks[0]);
  const image = rich.rich.content.flatMap(item => item.content || []).find(item => item.type === 'noteImage');
  image.attrs.width = 60; image.attrs.align = 'left';
  await f.execute('update_block', { noteId: note.id, blockId: rich.id, block: rich });
  assert.ok(JSON.stringify(note.blocks[0]).includes('原始内容'));
  const map = structuredClone(note.blocks[1]); map.nodes[1].shape = 'diamond'; map.edges[0].text = '质能关系';
  await f.execute('update_block', { noteId: note.id, blockId: map.id, block: map });
  assert.equal(note.blocks[1].edges[0].text, '质能关系');
  await f.execute('reorder_blocks', { noteId: note.id, ids: note.blocks.map(item => item.id).reverse() });
  assert.equal(note.blocks[0].type, 'mindmap');
  const created = await f.execute('create_note', { docId: 'doc1', page: 2, title: '复习', parts: [{ type: 'text', text: '新的笔记' }] });
  assert.match(JSON.stringify(f.state.notes.find(item => item.id === created.id).blocks), /新的笔记/);
  const copy = await f.execute('duplicate_note', { noteId: note.id, title: '副本' });
  assert.deepEqual(f.state.notes.find(item => item.id === copy.id).blocks, note.blocks);
  await f.execute('reorder_notes', { docId: 'doc1', page: 1, ids: [copy.id, note.id] });
  await f.execute('update_note', { noteId: copy.id, changes: { title: '改名', style: { paper: 'grid', accent: '#123456' } } });
  await f.execute('update_note', { noteId: copy.id, changes: { deleted: true } });
  await f.execute('update_note', { noteId: copy.id, changes: { deleted: false } });
  assert.equal((await f.execute('read_note', { noteId: copy.id })).title, '改名');
});

test('assistant supports mixed source annotations and preserves strokes when hiding or moving stickies', async () => {
  const f = fixture();
  await f.execute('link_source', { noteId: 'note1', page: 2, rect: { x: .1, y: .1, width: .2, height: .2 }, annotations: [{ type: 'text', text: '注意' }, { type: 'formula', text: 'x^2' }, { type: 'image', data: 'image:pixel' }] });
  const link = f.state.notes[0].links[0]; assert.equal(link.annotations.length, 3);
  await f.execute('link_source', { noteId: 'note1', linkId: link.id, page: 2, quote: '能量', annotations: [{ type: 'text', text: '更新批注' }] });
  assert.equal(f.state.notes[0].links[0].annotations[0].text, '更新批注');
  await f.execute('link_source', { noteId: 'note1', linkId: link.id, remove: true }); assert.equal(f.state.notes[0].links.length, 0);
  const strokes = [{ tool: 'highlighter', color: '#aabbcc', size: 18, points: [[.1, .2], [.2, .2]] }];
  await f.execute('update_markup', { docId: 'doc1', page: 1, strokes, stickies: [{ id: 's1', x: .2, y: .2, text: '复习', collapsed: false }] });
  await f.execute('update_markup', { docId: 'doc1', page: 1, stickies: [{ id: 's1', x: .5, y: .7, text: '复习', collapsed: true }] });
  const result = await f.execute('read_markup', { docId: 'doc1', page: 1 });
  assert.deepEqual(result.strokes, strokes); assert.equal(result.stickies[0].collapsed, true); assert.equal(result.stickies[0].x, .5);
});

test('assistant generation, templates, download and interactive entry tools are executable', async () => {
  const f = fixture();
  const result = await f.execute('generate_notes', { docId: 'doc1', pages: [1, 2], preset: 'paper', outline: ['公式', '重点'], guidance: '解释推导' });
  assert.equal(result.length, 2);
  const repeated = await f.execute('generate_notes', { docId: 'doc1', pages: [1, 3], preset: 'course' });
  assert.ok(repeated[0].skipped);
  await f.execute('update_note', { noteId: 'ai1', changes: { ai: { sections: [{ title: '结论', content: '仅修改AI部分' }] } } });
  const template = await f.execute('create_template', { name: '论文', sections: ['摘要'], style: { paper: 'lined' } });
  await f.execute('update_template', { templateId: template.id, name: '论文模板', sections: ['方法', '结论'] });
  assert.equal(f.state.templates[0].sections.length, 2);
  await f.execute('delete_template', { templateId: template.id }); assert.equal(f.state.templates.length, 0);
  await f.execute('backup', {}); await f.execute('export_notes', { docId: 'doc1' }); assert.equal(f.downloads.length, 2);
  await f.execute('copy_text', {}); assert.equal(f.downloads.at(-1), '当前选择');
  await f.execute('configure_view', { layout: 'split', zoom: 1.6, noteWidth: 500, treeOpen: false, showStickies: false, stickyPlacement: 'multiple' });
  assert.equal(f.views.at(-1).stickyPlacement, 'multiple');
  for (const feature of ['import', 'restore', 'models', 'templates', 'trash', 'library', 'drawing', 'mindmap', 'formula', 'image', 'region', 'pen', 'highlighter', 'eraser', 'sticky', 'undo', 'redo']) {
    const result = await f.execute('open_feature', { feature, docId: 'doc1', page: 1, noteId: 'note1' }); assert.ok(result.requiresUserInteraction);
  }
  assert.equal(f.features.length, 17);
  assert.equal(assistantContext(f.state, { docId: 'doc1', page: 1 }).current.document.id, 'doc1');
});

test('assistant rejects invalid targets, cross-document links, arbitrary image URLs and invalid payloads before writing', async () => {
  const f = fixture();
  const invalid = [
    call('unknown', {}), call('read_page', { docId: 'doc1', page: 0 }), call('read_page', { docId: 'doc1', page: 1.5 }),
    call('open_document', { docId: 'other-account', page: 1 }), call('create_folder', { name: ' ' }),
    call('update_document', { docId: 'doc1', changes: { folderId: 'missing' } }), call('update_document', { docId: 'doc1', changes: { execute: 'code' } }),
    call('append_content', { noteId: 'note1', parts: [{ type: 'image', data: 'https://untrusted/image.png' }] }),
    call('append_content', { noteId: 'note1', parts: [{ type: 'mindmap', nodes: [], edges: [{ from: 'missing', to: 'other' }] }] }),
    call('append_content', { noteId: 'note1', parts: [{ type: 'drawing', strokes: [{ tool: 'pen', color: '#123456', size: 3, points: [[-1, 2]] }] }] }),
    call('update_block', { noteId: 'note1', blockId: 'b1', block: { type: 'mixed', rich: { type: 'doc', content: [{ type: 'script' }] } } }),
    call('update_markup', { docId: 'doc1', page: 1, stickies: [{ id: 'x', x: 2, y: .1, text: '', collapsed: false }] }),
    call('link_source', { noteId: 'note1', page: 1, rect: { x: .9, y: .1, width: .3, height: .2 } }),
    call('generate_notes', { docId: 'doc1', pages: Array(11).fill(1) }), call('reorder_notes', { docId: 'doc1', page: 1, ids: ['note1', 'note1'] }),
  ];
  for (const tool of invalid) await assert.rejects(prepareAssistantTool(tool, f.env), undefined, tool.name);
  assert.equal(f.writes.length, 0);
  const stale = await prepareAssistantTool(call('append_content', { noteId: 'note1', parts: [{ type: 'text', text: '新内容' }] }), f.env);
  f.state.notes[0].title = '用户刚修改';
  await assert.rejects(stale.run(), /发生变化/);
  assert.equal(f.writes.length, 0);
});

test('assistant preserves expanded maps, node styles, arrows and supports automatic layout and dedicated export', async () => {
  const f = fixture();
  await f.execute('append_content', { noteId: 'note1', parts: [{ type: 'mindmap', width: 4000, height: 3000, nodes: [
    { id: 'root', text: '大画布', x: 1800, y: 1800, shape: 'rectangle', width: 240, fontSize: 18, fill: '#ffeeaa', textColor: '#123456', color: '#abcdef', bold: true },
    { id: 'other', text: '自由连线节点', x: 2400, y: 2100, shape: 'circle' },
  ], edges: [{ id: 'line', from: 'root', to: 'other', text: '关系', arrow: true, dashed: true }] }] });
  const block = f.state.notes[0].blocks.find(block => block.type === 'mindmap');
  assert.equal(block.width, 4000); assert.ok(block.nodes[0].x < 1000, 'new maps compact arbitrary model coordinates'); assert.equal(block.nodes[0].fontSize, 18); assert.equal(block.edges[0].arrow, true);
  await f.execute('configure_mindmap', { noteId: 'note1', blockId: block.id, layout: 'down', expand: true });
  const after = f.state.notes[0].blocks.find(item => item.id === block.id);
  assert.ok(after.width >= 4800); assert.ok(after.height >= 3600); assert.equal(after.nodes[0].fill, '#ffeeaa');
  await f.execute('export_mindmap', { noteId: 'note1', blockId: block.id, format: 'svg' }); assert.equal(f.downloads.at(-1)[0], 'mindmap');
  await assert.rejects(f.execute('configure_mindmap', { noteId: 'note1', blockId: block.id, width: 40000 }));
  await assert.rejects(f.execute('export_mindmap', { noteId: 'note1', blockId: block.id, format: 'exe' }));
});

test('assistant incrementally edits large maps without dropping untouched content, validates boundaries and refuses stale writes', async () => {
  const f = fixture();
  const nodes = Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, text: `节点${i}`, x: i * 180, y: 0, shape: 'rectangle', fill: '#abcdef' }));
  const block = { id: 'map', type: 'mindmap', width: 30000, height: 900, nodes, edges: [{ id: 'e', from: 'n0', to: 'n1', text: '原连线', arrow: true }] };
  f.state.notes[0].blocks.push(block);
  await f.execute('edit_mindmap', { noteId: 'note1', blockId: 'map', nodes: [{ id: 'n1', text: '局部修改', fontSize: 20 }], edges: [{ id: 'e', text: '新连线', dashed: true }] });
  let current = f.state.notes[0].blocks[1];
  assert.equal(current.nodes.length, 150); assert.equal(current.nodes[1].fill, '#abcdef'); assert.equal(current.nodes[1].x, 180); assert.equal(current.nodes[1].y, 0); assert.equal(current.nodes[1].fontSize, 20);
  assert.equal(current.edges[0].arrow, true); assert.equal(current.edges[0].dashed, true); assert.deepEqual(f.state.notes[0].blocks[0], { id: 'b1', type: 'text', text: '原始内容' });
  await f.execute('edit_mindmap', { noteId: 'note1', blockId: 'map', nodes: [{ id: 'new', text: '新增', x: 900, y: 600, shape: 'circle' }], edges: [{ id: 'new-edge', from: 'n0', to: 'new' }], removeNodes: ['n1'] });
  current = f.state.notes[0].blocks[1]; assert.equal(current.nodes.length, 150); assert.equal(current.edges.length, 1); assert.equal(current.edges[0].id, 'new-edge');
  const invalid = [
    { nodes: [{ id: 'new', collapsed: 'yes' }] }, { nodes: [{ id: 'bad', x: 0, y: 0 }] },
    { nodes: [{ id: 'new', x: 32000 }] }, { nodes: [{ id: 'new' }, { id: 'new' }] },
    { edges: [{ id: 'bad', from: 'n0', to: 'missing' }] }, { removeNodes: ['missing'] },
    { nodes: [{ id: 'new', text: '矛盾' }], removeNodes: ['new'] }, { edges: [{ id: 'new-edge', from: 'n0', to: 'n0' }] },
    { nodes: [{ id: 'new', execute: 'code' }] }, {},
  ];
  const snapshot = structuredClone(f.state); const count = f.writes.length;
  for (const args of invalid) await assert.rejects(f.execute('edit_mindmap', { noteId: 'note1', blockId: 'map', ...args }));
  await assert.rejects(f.execute('configure_mindmap', { noteId: 'note1', blockId: 'map', expand: 'false' }));
  assert.deepEqual(f.state, snapshot); assert.equal(f.writes.length, count);
  await f.execute('edit_mindmap', { noteId: 'note1', blockId: 'map', nodes: [{ id: 'new', text: '取消' }] }, false);
  assert.equal(f.writes.length, count);
  const prepared = await prepareAssistantTool(call('edit_mindmap', { noteId: 'note1', blockId: 'map', nodes: [{ id: 'new', text: '过期' }] }), f.env);
  f.state.notes[0].title = '刚编辑'; await assert.rejects(prepared.run(), /发生变化/);
  assert.equal(f.writes.length, count);
});

test('assistant regeneration shows concrete old and new notes before replacing and refuses stale or forged drafts', async () => {
  const f = fixture();
  f.state.notes.push({ id: 'ai1', docId: 'doc1', page: 1, kind: 'ai', title: '智能笔记', ai: { sections: [{ title: '旧标题', content: '旧正文' }] }, blocks: [{ id: 'personal', type: 'text', text: '个人补充' }], deleted: false });
  await assert.rejects(f.execute('commit_generation', { token: 'forged' }), /没有该草稿/);
  const candidate = await f.execute('preview_generation', { docId: 'doc1', page: 1, preset: 'paper' });
  const task = await prepareAssistantTool(call('commit_generation', { token: candidate.token }), f.env);
  assert.equal(task.confirm, true); assert.equal(task.confirmData.原有内容.sections[0].content, '旧正文'); assert.equal(task.confirmData.新草稿.sections[0].content, '新正文');
  assert.equal(f.state.notes.at(-1).ai.sections[0].content, '旧正文');
  await task.run();
  assert.equal(f.state.notes.at(-1).ai.sections[0].content, '新正文'); assert.equal(f.state.notes.at(-1).blocks[0].text, '个人补充');
  await f.execute('preview_generation', { docId: 'doc1', page: 1 });
  f.state.notes.at(-1).ai.sections[0].content = '刚修改';
  await assert.rejects(f.execute('commit_generation', { token: candidate.token }), /已经变化/);
});

test('assistant loop observes real results before its next step and cancels without writes', async () => {
  const f = fixture(); const events = []; let turn = 0;
  const result = await runAssistantTask({
    history: [{ role: 'user', content: '新建文件夹并移动论文' }], context: async () => ({}), env: f.env,
    confirm: async () => true, emit: event => events.push(event), refresh: async () => {},
    ask: async ({ history }) => {
      if (++turn === 1) return { reply: '创建文件夹', tool: call('create_folder', { name: '研究' }) };
      const observation = JSON.parse(history.at(-1).content.split('：').slice(1).join('：'));
      if (turn === 2) return { reply: '移入资料', tool: call('update_document', { docId: 'doc1', changes: { folderId: observation.result.id } }) };
      assert.equal(observation.ok, true); return { reply: '已完成', tool: null };
    },
  });
  assert.equal(f.state.docs[0].folderId, f.state.folders[0].id); assert.equal(result.observations.length, 2); assert.equal(events.filter(item => item.status === 'done').length, 2);
  const before = f.writes.length;
  await runAssistantTask({ history: [{ role: 'user', content: '删除论文' }], context: async () => ({}), env: f.env, emit: () => {}, refresh: async () => {}, confirm: async () => false, ask: async () => ({ reply: '', tool: call('update_document', { docId: 'doc1', changes: { deleted: true } }) }) });
  assert.equal(f.writes.length, before); assert.equal(f.state.docs[0].deleted, false);
});

test('assistant loop stops on abort, rejects repeated writes and stops after bounded steps', async () => {
  const f = fixture(); const controller = new AbortController();
  const settings = { history: [{ role: 'user', content: '执行' }], context: async () => ({}), env: f.env, emit: () => {}, refresh: async () => {}, confirm: async () => true };
  await assert.rejects(runAssistantTask({ ...settings, env: { ...f.env, signal: controller.signal }, ask: async () => { controller.abort(); return { reply: '', tool: call('create_folder', { name: '不能创建' }) }; } }));
  assert.equal(f.writes.length, 0);
  let round = 0;
  await runAssistantTask({ ...settings, ask: async () => ++round > 2 ? { reply: '完成', tool: null } : { reply: '', tool: call('append_content', { noteId: 'note1', parts: [{ type: 'text', text: '只追加一次' }] }) } });
  assert.equal(f.writes.filter(item => item[0] === '/notes/note1').length, 1);
  await assert.rejects(runAssistantTask({ ...settings, limit: 2, ask: async () => ({ reply: '', tool: call('search', { query: '' }) }) }), /上限/);
  await assert.rejects(runAssistantTask({ ...settings, ask: async () => ({ reply: '', tool: call('read_note', { noteId: 'unknown' }) }) }), /三次/);
});

test('assistant selects adaptive generation unless user requests a template and forwards both preview modes', async () => {
  const f = fixture();
  await f.execute('generate_notes', { docId: 'doc1', pages: [1], mode: 'adaptive', outline: ['不应强制'], guidance: '根据内容' });
  let sent = f.writes.find(w => w[0] === '/generate')[2]; assert.equal(sent.mode, 'adaptive'); assert.equal(sent.outline, undefined);
  await f.execute('generate_notes', { docId: 'doc1', pages: [2], preset: 'paper', mode: 'template' }); sent = f.writes.filter(w => w[0] === '/generate').at(-1)[2]; assert.deepEqual(sent.outline, ['研究问题与背景', '核心方法', '关键公式与图表', '实验设计与结果', '主要结论', '局限与待思考问题']);
  await f.execute('generate_notes', { docId: 'doc1', pages: [3] }); assert.equal(f.writes.filter(w => w[0] === '/generate').at(-1)[2].mode, 'adaptive');
  await f.execute('preview_generation', { docId: 'doc1', page: 1, mode: 'adaptive' }); assert.equal(f.writes.filter(w => w[0] === '/generate').at(-1)[2].mode, 'adaptive');
  const count = f.writes.length; await assert.rejects(f.execute('generate_notes', { docId: 'doc1', pages: [1], mode: 'unknown' })); assert.equal(f.writes.length, count);
});

test('new mind maps ignore missing, negative and excessive model coordinates but existing node moves stay validated', async () => {
  const f = fixture();
  await f.execute('append_content', { noteId: 'note1', parts: [{ type: 'mindmap', nodes: [
    { id: 'root', text: '主题', x: -2000, y: -100 }, { id: 'child', text: '要点' }, { id: 'other', text: '结论', x: 9999999, y: 'bad' },
  ], edges: [{ id: 'e1', from: 'root', to: 'child' }, { id: 'e2', from: 'root', to: 'other' }] }] });
  let graph = f.state.notes[0].blocks.find(b => b.type === 'mindmap');
  assert.equal(graph.nodes.length, 3); assert.ok(graph.nodes.every(n => n.x >= 0 && n.y >= 0 && n.x < 32000));
  await f.execute('edit_mindmap', { noteId: 'note1', blockId: graph.id, nodes: [{ id: 'new', text: '新节点不需要坐标' }], edges: [{ id: 'e3', from: 'child', to: 'new' }] });
  graph = f.state.notes[0].blocks.find(b => b.type === 'mindmap'); assert.equal(graph.nodes.length, 4); assert.ok(graph.nodes.find(n => n.id === 'new').x >= 0);
  await assert.rejects(f.execute('edit_mindmap', { noteId: 'note1', blockId: graph.id, nodes: [{ id: 'root', x: -1 }] }), /范围/);
  await assert.rejects(f.execute('append_content', { noteId: 'note1', parts: [{ type: 'mindmap', nodes: [{ id: 'r', text: '主题' }], edges: [{ from: 'r', to: 'missing' }] }] }));
});
