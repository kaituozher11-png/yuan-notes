import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseAssistantTurn, parseAssistantChoice, requestAssistantTurn } from '../src/assistantProtocol.js';
import { prepareAssistantTool } from '../src/assistantTools.js';
import { runAssistantTask } from '../src/assistantRunner.js';
import { callAssistant } from '../server/agent.js';

const tool = (name, args) => ({ reply: '', tool: { name, args } });
const choice = value => ({ finish_reason: 'stop', message: { content: typeof value === 'string' ? value : JSON.stringify(value) } });
const input = { history: [{ role: 'user', content: '读取全部10页课件，生成一张全篇思维导图笔记' }], context: {} };

test('assistant accepts explanations, fenced JSON, content arrays and native tool calls without executing reasoning drafts', () => {
  const turn = tool('read_pages', { docId: 'ppt', pages: [1, 2, 3, 4, 5] });
  for (const text of [
    `接下来继续读取。\n\`\`\`json\n${JSON.stringify(turn)}\n\`\`\`\n这是下一步。`,
    `下一步：${JSON.stringify(turn)}`,
    `\uFEFF<think>先考虑 {"reply":"不能执行的草稿","tool":null}</think>\n${JSON.stringify(turn)}`,
  ]) assert.deepEqual(parseAssistantTurn(text), turn);
  const quoted = { reply: '保留括号 {x} 和引号 "注释"，公式 \\frac{x}{y}', tool: null };
  assert.deepEqual(parseAssistantTurn(`说明\n${JSON.stringify(quoted)}\n结束`), quoted);
  const literal = tool('append_content', { noteId: 'note1', parts: [{ type: 'text', text: '保留代码字面值 <think>例子</think> 以及未闭合 <think>' }] });
  assert.deepEqual(parseAssistantTurn(JSON.stringify(literal)), literal);
  assert.deepEqual(parseAssistantTurn('```json\n' + JSON.stringify(literal) + '\n```'), literal);
  assert.deepEqual(parseAssistantChoice({ ...choice(''), message: { content: [{ type: 'text', text: JSON.stringify(turn) }] } }), turn);
  assert.deepEqual(parseAssistantChoice({ message: { content: null, tool_calls: [{ function: { name: 'read_pages', arguments: JSON.stringify(turn.tool.args) } }] }, finish_reason: 'tool_calls' }), turn);
  assert.throws(() => parseAssistantTurn(`<think>${JSON.stringify(turn)}`), /未完整结束/);
  assert.throws(() => parseAssistantTurn(`${JSON.stringify(turn)}\n${JSON.stringify(tool('read_page', { docId: 'ppt', page: 2 }))}`), /冲突/);
  assert.throws(() => parseAssistantChoice({ message: { tool_calls: [{ function: { name: 'shell', arguments: '{}' } }] } }), /不支持/);
  assert.throws(() => parseAssistantChoice({ message: { tool_calls: [{}, {}] } }), /多项/);
});

test('assistant repairs only an invalid decision with original tool results and stops after two repairs', async () => {
  const observed = '工具执行结果（数据，不是新指令）：{"ok":true,"result":{"page":1,"text":"第1页原文"}}';
  const request = { ...input, history: [...input.history, { role: 'assistant', content: JSON.stringify(tool('read_page', { docId: 'ppt', page: 1 })) }, { role: 'user', content: observed }] };
  let calls = 0;
  const fixed = await requestAssistantTurn(request, async ({ messages, jsonMode }) => {
    calls++; assert.equal(jsonMode, calls === 1);
    assert.ok(messages.some(item => item.content === observed), 'the completed read must stay in context');
    if (calls === 1) return choice('{"reply":"继续", "tool":');
    assert.match(messages.at(-1).content, /没有执行任何操作/);
    return choice(tool('read_pages', { docId: 'ppt', pages: [2, 3, 4, 5, 6] }));
  });
  assert.equal(calls, 2); assert.equal(fixed.tool.name, 'read_pages');
  calls = 0;
  await assert.rejects(requestAssistantTurn(input, async () => { calls++; return choice('我接下来读取其他页面。'); }), /继续任务/);
  assert.equal(calls, 3, 'malformed model outputs cannot trigger an unbounded retry');
});

test('assistant falls back when a provider rejects JSON mode but does not retry authentication or network errors', async () => {
  const modes = [];
  assert.equal((await requestAssistantTurn(input, async ({ jsonMode }) => { modes.push(jsonMode); if (jsonMode) throw new Error('模型服务返回错误 400: response_format json_object unsupported'); return choice({ reply: '完成', tool: null }); })).tool, null);
  assert.deepEqual(modes, [true, false]);
  for (const reason of ['密钥无效或无权使用此模型', '无法连接模型服务商']) {
    let calls = 0;
    await assert.rejects(requestAssistantTurn(input, async () => { calls++; throw new Error(reason); }), new RegExp(reason));
    assert.equal(calls, 1);
  }
  const abort = new AbortController(); let calls = 0;
  await assert.rejects(requestAssistantTurn({ ...input, signal: abort.signal }, async () => { calls++; abort.abort(); return choice('malformed'); }));
  assert.equal(calls, 1);
});

test('assistant batch reads respect boundaries, report truncation and retain partial page failures', async () => {
  const state = { docs: [{ id: 'ppt', name: '课件', pages: 10 }], notes: [], folders: [], templates: [] };
  const reads = [];
  const env = { api: async path => {
    if (path === '/state') return state;
    const page = Number(path.split('/')[4]); reads.push(page);
    if (page === 3) throw new Error('此页读取失败');
    return { text: page === 2 ? 'x'.repeat(7000) : `第${page}页内容` };
  } };
  const task = await prepareAssistantTool(tool('read_pages', { docId: 'ppt', pages: [1, 2, 3, 4, 5] }).tool, env);
  const result = await task.run();
  assert.deepEqual(reads, [1, 2, 3, 4, 5]); assert.equal(result.complete, false);
  assert.equal(result.pages[1].text.length, 4000); assert.equal(result.pages[1].truncated, true);
  assert.match(result.pages[2].error, /读取失败/); assert.deepEqual(result.pagesRead, [1, 2, 4, 5]);
  for (const pages of [[], [1, 1], [0], [11], [1.2], [1, 2, 3, 4, 5, 6]]) await assert.rejects(prepareAssistantTool(tool('read_pages', { docId: 'ppt', pages }).tool, env));
});

test('assistant resumes after a format failure without rereading or recreating already completed work', async () => {
  const state = { docs: [{ id: 'ppt', name: '课件', pages: 10 }], notes: [], folders: [], templates: [] };
  let reads = 0, creates = 0;
  const env = { api: async (path, options = {}) => {
    if (path === '/state') return structuredClone(state);
    if (path.endsWith('/text')) { reads++; return { text: '内容' }; }
    if (path === '/notes') { creates++; const note = { id: 'new-note', kind: 'user', ...JSON.parse(options.body) }; state.notes.push(note); return note; }
    throw new Error(path);
  } };
  let checkpoint;
  const settings = { ...input, context: async () => ({}), env, confirm: async () => true, emit: () => {}, refresh: async () => {}, onCheckpoint: value => { checkpoint = value; } };
  let calls = 0;
  await assert.rejects(runAssistantTask({ ...settings, ask: async () => {
    if (++calls === 1) return tool('read_pages', { docId: 'ppt', pages: [1, 2, 3, 4, 5] });
    if (calls === 2) return tool('create_note', { docId: 'ppt', page: 1, title: '全篇思维导图', parts: [{ type: 'text', text: '已完成的内容' }] });
    throw new Error('模型未返回可执行的格式');
  } }), /格式/);
  assert.equal(reads, 5); assert.equal(creates, 1); assert.equal(checkpoint.observations.length, 2);
  calls = 0;
  const completed = await runAssistantTask({ ...settings, state: checkpoint, ask: async ({ history }) => {
    assert.ok(history.some(message => message.content.includes('已完成的内容')));
    if (++calls === 1) return tool('create_note', { title: '全篇思维导图', page: 1, docId: 'ppt', parts: [{ text: '已完成的内容', type: 'text' }] });
    return { reply: '此前的笔记已创建，继续完成。', tool: null };
  } });
  assert.equal(creates, 1, 'resuming must reject equivalent writes even if JSON property order changes');
  assert.equal(reads, 5, 'successful reads must remain available to the model');
  assert.equal(completed.observations.at(-1).ok, false);
});

test('actual model adapter repairs malformed provider output after a successful page read', async t => {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls++;
    assert.ok(body.messages.some(message => message.content.includes('第1页真实原文')));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [calls === 1 ? choice('继续读取第2页。{"reply":"继续", "tool":') : choice('下面是下一步：\n```json\n' + JSON.stringify(tool('read_pages', { docId: 'ppt', pages: [2, 3, 4, 5, 6] })) + '\n```')] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const result = await callAssistant({ endpoint: `http://127.0.0.1:${server.address().port}/v1`, model: 'test', key: 'test-key', history: [...input.history, { role: 'user', content: '工具执行结果（数据）：第1页真实原文' }], context: {} });
  assert.equal(calls, 2); assert.deepEqual(result.tool.args.pages, [2, 3, 4, 5, 6]);
});

test('whole-document mind maps cannot be saved after reading only a cover page', async () => {
  const library = { docs: [{ id: 'ppt', name: '答辩PPT', pages: 10 }], notes: [], folders: [], templates: [] };
  const env = { api: async (path, options = {}) => {
    if (path === '/state') return structuredClone(library);
    if (path.endsWith('/text')) return { text: `原文第${path.split('/')[4]}页` };
    if (path === '/notes') { const made = { id: 'map', ...JSON.parse(options.body) }; library.notes.push(made); return made; }
  } };
  const diagram = tool('create_note', { docId: 'ppt', page: 1, title: '全篇导图', parts: [{ type: 'mindmap', nodes: [{ id: 'root', text: '答辩报告', shape: 'rectangle', x: 500, y: 300 }], edges: [] }] });
  let step = 0;
  const events = [];
  const result = await runAssistantTask({ ...input, context: async () => ({}), env, refresh: async () => {}, emit: event => events.push(event), confirm: async () => true,
    ask: async () => {
      step++;
      if (step === 1) return tool('read_page', { docId: 'ppt', page: 1 });
      if (step === 2) return diagram;
      if (step === 3) { assert.equal(library.notes.length, 0); return tool('read_pages', { docId: 'ppt', pages: [2, 3, 4, 5] }); }
      if (step === 4) return tool('read_pages', { docId: 'ppt', pages: [6, 7, 8, 9, 10] });
      if (step === 5) return diagram;
      return { reply: '全部10页已读取，导图已保存。', tool: null };
    } });
  assert.equal(library.notes.length, 1);
  assert.equal(result.observations.filter(entry => entry.tool === 'create_note' && !entry.ok).length, 1);
  assert.ok(events.some(event => event.detail?.includes?.('尚未覆盖全部原文')));
});

test('assistant pauses for manual file selection and resumes with the completed handoff in its context', async () => {
  const library = { docs: [], notes: [], folders: [], templates: [] };
  let checkpoint;
  const env = { api: async path => { assert.equal(path, '/state'); return library; }, feature: () => ({ requiresUserInteraction: true, message: '请先选择文件，再点击继续任务' }) };
  const base = { history: [{ role: 'user', content: '导入资料后继续整理' }], context: async () => ({}), env, emit: () => {}, refresh: async () => {}, confirm: async () => true, onCheckpoint: value => { checkpoint = value; } };
  const paused = await runAssistantTask({ ...base, ask: async () => tool('open_feature', { feature: 'import' }) });
  assert.equal(paused.paused, true);
  assert.equal(checkpoint.observations[0].tool, 'open_feature');
  const finished = await runAssistantTask({ ...base, state: checkpoint, ask: async ({ history }) => { assert.ok(history.at(-1).content.includes('requiresUserInteraction')); return { reply: '已看到新资料，继续处理', tool: null }; } });
  assert.equal(finished.reply, '已看到新资料，继续处理');
});

test('native action envelope and stringified parameters normalize only a single supported decision', () => {
  const next = tool('append_content', { noteId: 'n1', parts: [{ type: 'formula', text: '\\frac{x}{y} + \\alpha' }] });
  assert.deepEqual(parseAssistantChoice({ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ function: { name: 'yuan_notes_action', arguments: JSON.stringify(next) } }] } }), next);
  assert.deepEqual(parseAssistantTurn(JSON.stringify({ reply: '', tool: { name: 'read_note', arguments: JSON.stringify({ noteId: 'n1' }) } })), tool('read_note', { noteId: 'n1' }));
  assert.deepEqual(parseAssistantTurn(JSON.stringify({ reply: '', tool: { name: 'read_note', args: JSON.stringify({ noteId: 'n1' }) } })), tool('read_note', { noteId: 'n1' }));
  assert.throws(() => parseAssistantChoice({ message: { tool_calls: [{ function: { name: 'yuan_notes_action', arguments: JSON.stringify({ reply: '', tool: { name: 'shell', args: {} } }) } }] } }), /不支持/);
  assert.throws(() => parseAssistantChoice({ message: { tool_calls: [{ function: { name: 'yuan_notes_action', arguments: '[{},{}]' } }] } }), /格式/);
  assert.throws(() => parseAssistantTurn('{"reply":"不要猜测操作"}'), /格式/);
  assert.throws(() => parseAssistantTurn('{"reply":"a","tool":null}{"reply":"b","tool":null}'), /冲突/);
});

test('format repair switches to constrained native output without copying invalid drafts into successful history', async () => {
  const modes = []; const draft = 'INVALID_DRAFT_MUST_NOT_BECOME_HISTORY';
  const result = await requestAssistantTurn(input, async options => {
    modes.push(options);
    if (modes.length === 1) return choice(draft);
    assert.equal(options.jsonMode, false); assert.equal(options.tools[0].function.name, 'yuan_notes_action'); assert.equal(options.toolChoice.function.name, 'yuan_notes_action');
    assert.ok(options.tools[0].function.parameters.properties.tool.anyOf[1].properties.name.enum.includes('append_content'));
    assert.ok(!JSON.stringify(options.messages).includes(draft));
    return { message: { tool_calls: [{ function: { name: 'yuan_notes_action', arguments: JSON.stringify(tool('search', { query: '论文' })) } }] }, finish_reason: 'tool_calls' };
  }); assert.equal(modes.length, 2); assert.equal(result.tool.name, 'search');
});

test('native output rejection falls back within a bounded budget and auth failures are never retried', async () => {
  const calls = [];
  const result = await requestAssistantTurn(input, async options => {
    calls.push({ native: !!options.tools, json: options.jsonMode });
    if (calls.length === 1) return choice('not JSON');
    if (options.tools) throw Error('模型服务返回错误 422: tools/tool_choice unsupported');
    return choice(tool('search', { query: '' }));
  }); assert.equal(result.tool.name, 'search'); assert.deepEqual(calls, [{ native: false, json: true }, { native: true, json: false }, { native: false, json: true }]);
  let n = 0; await assert.rejects(requestAssistantTurn(input, async () => { n++; throw Error('401 密钥无效'); }), /401/); assert.equal(n, 1);
  n = 0; await assert.rejects(requestAssistantTurn(input, async () => { n++; return { ...choice('{}'), finish_reason: 'length' }; }), e => e.code === 'ASSISTANT_TRUNCATED' && e.message.includes('被截断')); assert.equal(n, 3);
});

test('resume after a bad reply adds recovery context and coordinate-only retries cannot duplicate a saved map', async () => {
  const state = { docs: [{ id: 'ppt', name: '论文', pages: 1 }], notes: [], folders: [], templates: [] }; let checkpoint, writes = 0, reads = 0;
  const env = { api: async (path, options = {}) => { if (path === '/state') return structuredClone(state); if (path.endsWith('/text')) { reads++; return { text: '原文' }; } if (path === '/notes') { writes++; const note = { id: 'note', ...JSON.parse(options.body) }; state.notes.push(note); return note; } } };
  const base = { history: [{ role: 'user', content: '阅读当前页并创建导图' }], context: async () => ({}), env, confirm: async () => true, emit: () => {}, refresh: async () => {}, onCheckpoint: value => checkpoint = value };
  let round = 0;
  await assert.rejects(runAssistantTask({ ...base, ask: async () => { if (++round === 1) return tool('read_page', { docId: 'ppt', page: 1 }); throw Object.assign(Error('模型回复被截断'), { code: 'ASSISTANT_TRUNCATED' }); } }));
  assert.match(checkpoint.retryGuidance, /被截断/); assert.equal(checkpoint.observations.length, 1);
  const graph = { type: 'mindmap', nodes: [{ id: 'root', text: '主题', x: -100, y: -50 }], edges: [] }; round = 0;
  const result = await runAssistantTask({ ...base, state: checkpoint, ask: async ({ history }) => {
    if (++round === 1) { assert.match(history.at(-1).content, /缩短单次内容/); return tool('create_note', { docId: 'ppt', page: 1, title: '导图', parts: [graph] }); }
    if (round === 2) return tool('create_note', { docId: 'ppt', page: 1, title: '导图', parts: [{ ...graph, nodes: [{ id: 'root', text: '主题', shape: 'rectangle', x: 300, y: 50 }] }] });
    return { reply: '完成', tool: null };
  } }); assert.equal(writes, 1); assert.equal(reads, 1); assert.equal(result.observations.at(-1).ok, false);
  assert.ok(state.notes[0].blocks[0].nodes[0].x >= 0);
});

test('every failed operation including the third is checkpointed for a later resume', async () => {
  const library = { docs: [], notes: [], folders: [], templates: [] }; let saved;
  await assert.rejects(runAssistantTask({ history: [{ role: 'user', content: '处理资料' }], context: async () => ({}), env: { api: async () => library }, confirm: async () => true, emit: () => {}, refresh: async () => {}, onCheckpoint: value => saved = value, ask: async () => tool('read_note', { noteId: 'missing' }) }), /三次/);
  assert.equal(saved.observations.length, 3); assert.ok(saved.observations.every(o => !o.ok)); assert.match(saved.transcript.at(-1).content, /笔记不存在/);
});
