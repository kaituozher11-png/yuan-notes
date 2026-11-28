import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { requestNoteJson } from '../src/aiNoteRequest.js';
import { callModel } from '../server/agent.js';
import { generateOrganizedNote } from '../src/aiNoteOutline.js';

const messages = [{ role: 'system', content: '只依据原文生成 JSON' }, { role: 'user', content: '本页原文与图片' }];
const choice = (content, finish_reason = 'stop') => ({ message: { content }, finish_reason });
const cutError = () => Object.assign(new Error('输出被截断'), { code: 'NOTE_OUTPUT_TRUNCATED' });

test('continues exact JSON across Chinese, escaped LaTeX, strings and structure boundaries', async () => {
  const value = { sections: [{ content: '公式 $\\frac{a}{b}$，文字与中文 123 连续。'.repeat(500) }, { content: '第二部分\n完整结论' }] };
  const raw = JSON.stringify(value);
  for (const positions of [[1], [raw.indexOf('frac') - 1], [raw.indexOf('中文') + 1], [raw.length - 1], [200, 800, 1800]]) {
    const chunks = []; let at = 0;
    for (const end of [...positions, raw.length]) { chunks.push(raw.slice(at, end)); at = end; }
    let calls = 0, previous = '';
    const result = await requestNoteJson({ messages, send: async supplied => {
      assert.deepEqual(supplied.slice(0, 2), messages);
      if (calls) { assert.equal(supplied[2].role, 'assistant'); assert.equal(supplied[2].content, previous); assert.equal(supplied[3].role, 'user'); }
      const chunk = chunks[calls++]; previous += chunk;
      return choice(chunk, calls === chunks.length ? 'stop' : 'length');
    } });
    assert.deepEqual(result, value); assert.equal(calls, chunks.length);
  }
});

test('empty reasoning truncation retries; truncated complete-looking JSON is never accepted on its own', async () => {
  let calls = 0;
  assert.deepEqual(await requestNoteJson({ messages, send: async () => ++calls === 1 ? choice(null, 'length') : choice('{"summary":"完整"}') }), { summary: '完整' });
  assert.equal(calls, 2);
  for (const reason of ['length', 'max_tokens', 'max_output_tokens']) {
    calls = 0;
    await assert.rejects(requestNoteJson({ messages, send: async () => { calls++; return choice('{"summary":"看似完整"}', reason); } }), error => error.code === 'NOTE_OUTPUT_TRUNCATED');
    assert.equal(calls, 4, 'bounded recovery prevents infinite provider loops');
  }
});

test('bad continuations, service errors, filtered output and cancellation cannot save a partial note', async () => {
  let calls = 0;
  await assert.rejects(requestNoteJson({ messages, send: async () => ++calls === 1 ? choice('{"sections":[', 'length') : choice('重新生成：内容') }), error => error.code === 'NOTE_OUTPUT_TRUNCATED');
  await assert.rejects(requestNoteJson({ messages, send: async () => choice('{"summary":"半段"}', 'content_filter') }), /拦截/);
  const service = new Error('余额不足'); calls = 0;
  await assert.rejects(requestNoteJson({ messages, send: async () => { calls++; throw service; } }), error => error === service);
  assert.equal(calls, 1);
  await assert.rejects(requestNoteJson({ messages, send: async () => choice('not JSON') }), /格式/);
  const abort = new AbortController(); calls = 0;
  await assert.rejects(requestNoteJson({ messages, signal: abort.signal, send: async () => { calls++; abort.abort(); return choice('{"summary":"', 'length'); } }), error => error.name === 'AbortError');
  assert.equal(calls, 1);
});

test('template and adaptive recovery generate all original sections in order without shortening', async () => {
  for (const mode of ['template', 'adaptive']) {
    const titles = ['推导假设', '公式说明', '结论与边界']; let writes = 0;
    const source = '保留全部解释 $E=mc^2$'.repeat(500);
    const result = await generateOrganizedNote({ page: 5, mode, outline: titles, guidance: '保留完整推导', request: async (instruction, stage) => {
      if (stage === 'plan') return { titles };
      writes++;
      assert.match(instruction, /第 5 页/); assert.match(instruction, /保留完整推导/);
      if (writes === 1) throw cutError();
      assert.ok(instruction.includes(JSON.stringify([titles[writes - 2]])));
      return { sections: [{ content: source }] };
    } });
    assert.deepEqual(result.sections, titles.map(title => ({ title, content: source })));
    assert.equal(writes, 4);
    if (mode === 'adaptive') assert.deepEqual(result.organization, { mode: 'adaptive', titles });
  }
});

test('a failed, empty, cancelled or malformed split section rejects the entire page', async () => {
  for (const failure of ['truncated', 'empty', 'missing', 'cancel']) {
    let calls = 0; const controller = new AbortController();
    await assert.rejects(generateOrganizedNote({ page: 1, outline: ['一', '二', '三'], signal: controller.signal, request: async () => {
      calls++; if (calls === 1) throw cutError();
      if (calls === 2) return { sections: [{ content: '第一部分已经完成' }] };
      if (failure === 'truncated') throw cutError();
      if (failure === 'cancel') controller.abort();
      return failure === 'missing' ? {} : { sections: [{ content: '' }] };
    } }));
    assert.equal(calls, 3, 'stop at the failed section without writing later ones');
  }
});

test('legacy split recovery keeps all six original fields and formulas', async () => {
  const keys = ['summary', 'concepts', 'important', 'cautions', 'formula', 'quiz']; let calls = 0;
  const result = await generateOrganizedNote({ page: 2, request: async instruction => {
    if (++calls === 1) throw cutError();
    const key = keys[calls - 2]; assert.match(instruction, new RegExp(`只需返回字段 ${key}`));
    return { [key]: key === 'summary' ? '完整摘要' : [`${key} $x^2$`] };
  } });
  assert.deepEqual(result, Object.fromEntries(keys.map(key => [key, key === 'summary' ? '完整摘要' : [`${key} $x^2$`]])));
  assert.equal(calls, 7);
});

test('HTTP note requests omit all output caps in planning, writing, continuation and connection test', async t => {
  const log = []; let connectionCalls = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw); log.push(payload);
    for (const key of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) assert.equal(Object.hasOwn(payload, key), false);
    let result;
    if (payload.messages[0].content.includes('格式测试')) result = ++connectionCalls === 1 ? choice(null, 'length') : choice('{"summary":"连接正常"}');
    else if (payload.messages[0].content.includes('结构规划师')) result = choice('{"titles":["本页推导"]}');
    else if (payload.messages.length === 2) result = choice('{"sections":[{"content":"公式 $\\\\frac{a}', 'length');
    else result = choice('{b}$ 与完整解释"}]}');
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [result] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const input = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, model: 'mock', key: 'test-only', page: 1, text: '原文', image: 'data:image/png;base64,YQ==' };
  const note = await callModel({ ...input, mode: 'adaptive' });
  assert.equal(note.sections[0].content, '公式 $\\frac{a}{b}$ 与完整解释');
  assert.equal(log.length, 3); assert.deepEqual(log[1].messages.slice(0, 2), log[2].messages.slice(0, 2));
  assert.deepEqual(await callModel({ ...input, test: true }), { ok: true });
  assert.equal(connectionCalls, 2, 'reasoning-only truncated replies can recover through the actual transport');
});
