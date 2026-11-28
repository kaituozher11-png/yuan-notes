import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { normalizeEndpoint, callModel } from '../server/agent.js';
import { parseWindowsProxy, modelDispatcher } from '../server/model-network.js';

test('uses valid Windows proxy settings while keeping local models direct', () => {
  assert.deepEqual(parseWindowsProxy('127.0.0.1:7897'), { httpProxy: 'http://127.0.0.1:7897/', httpsProxy: 'http://127.0.0.1:7897/' });
  assert.deepEqual(parseWindowsProxy('http=127.0.0.1:7897;https=127.0.0.1:7898'), { httpProxy: 'http://127.0.0.1:7897/', httpsProxy: 'http://127.0.0.1:7898/' });
  assert.equal(parseWindowsProxy('bad address'), null);
  assert.equal(modelDispatcher('http://127.0.0.1:8080/v1/chat/completions'), undefined);
});

test('only secure or local model endpoints are accepted', () => {
  assert.equal(normalizeEndpoint('https://example.com/v1'), 'https://example.com/v1/chat/completions');
  assert.equal(normalizeEndpoint('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080/v1/chat/completions');
  assert.throws(() => normalizeEndpoint('http://example.com/v1'), /HTTPS/);
  assert.throws(() => normalizeEndpoint('https://user:secret@example.com/v1'), /账号或密码/);
});

test('model adapter handles success, malformed output and authentication errors', async (t) => {
  let mode = 'ok';
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.headers.authorization, 'Bearer test-key');
    assert.equal(JSON.parse(body).model, 'study-model');
    if (mode === 'unauthorized') { res.writeHead(401); return res.end('{}'); }
    if (mode === 'invalid-model') {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Model study-model does not exist; Bearer test-key' } }));
    }
    if (mode === 'invalid-model-no-detail') { res.writeHead(400); return res.end('bad request'); }
    const note = JSON.stringify({ summary: '学习要点', concepts: ['概念'], evidence: [{ quote: '旧格式摘录' }] });
    const content = mode === 'bad' ? 'not JSON'
      : mode === 'wrapped' ? `以下是笔记：\n\`\`\`json\n${note}\n\`\`\``
      : mode === 'truncated' ? '{"summary":"学习要点"'
      : note;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: mode === 'truncated' ? 'length' : 'stop', message: { content } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const input = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, key: 'test-key', model: 'study-model', page: 2, text: '能量守恒定律' };
  assert.equal((await callModel(input)).evidence, undefined);
  assert.deepEqual(await callModel({ ...input, test: true }), { ok: true });
  mode = 'wrapped'; assert.equal((await callModel(input)).summary, '学习要点');
  mode = 'truncated'; await assert.rejects(callModel(input), /输出被截断/);
  mode = 'bad'; await assert.rejects(callModel(input), /格式/);
  await assert.rejects(callModel({ ...input, test: true }), /模型已连接.*笔记格式/);
  mode = 'unauthorized'; await assert.rejects(callModel(input), /密钥无效/);
  mode = 'invalid-model';
  await assert.rejects(callModel({ ...input, test: true }), (error) => {
    assert.match(error.message, /错误 400.*study-model does not exist/);
    assert.doesNotMatch(error.message, /test-key/);
    return true;
  });
  mode = 'invalid-model-no-detail';
  await assert.rejects(callModel({ ...input, test: true }), /核对接口地址、模型 ID 和请求参数/);
});

test('model adapter sends custom headings and rejects incomplete generated notes', async (t) => {
  let responseSections = [{ content: '方法分析' }, { content: '$E=mc^2$' }];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw);
    assert.match(payload.messages[0].content, /研究方法/);
    assert.match(payload.messages[0].content, /公式推导/);
    assert.match(payload.messages[0].content, /突出关键结论/);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ sections: responseSections }) } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const input = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, key: 'test-key', model: 'study-model', page: 2, text: '能量守恒定律', outline: ['研究方法', '公式推导'], guidance: '突出关键结论' };
  const note = await callModel(input);
  assert.deepEqual(note.sections.map(({ title }) => title), input.outline);
  assert.equal(note.sections[1].content, '$E=mc^2$');
  responseSections = [{ content: '缺少一项' }];
  await assert.rejects(callModel(input), /完整笔记/);
});

test('adaptive model requests read the source twice, plan per page, reject invalid plans and preserve explicit templates', async t => {
  const log = []; let invalid = false, truncated = false;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw), instruction = payload.messages[0].content, source = JSON.stringify(payload.messages[1].content);
    const planning = instruction.includes('结构规划师'); log.push({ planning, source });
    const titles = source.includes('Derivation') ? ['推导前提', '公式的来龙去脉', '适用范围'] : ['本页主题'];
    const note = planning ? invalid ? { titles: ['重复', '重复'] } : { titles } : { sections: titles.map(title => ({ content: `## ${title}\n解释 $x^2$` })) };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: truncated ? 'length' : 'stop', message: { content: JSON.stringify(note) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const input = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, key: 'test-key', model: 'study-model', mode: 'adaptive', page: 1, text: 'Cover', image: 'data:image/png;base64,YQ==' };
  const cover = await callModel(input); const derivation = await callModel({ ...input, page: 2, text: 'Derivation' });
  assert.equal(cover.sections.length, 1); assert.equal(derivation.sections.length, 3); assert.deepEqual(log.map(c => c.planning), [true, false, true, false]);
  assert.equal(log[0].source, log[1].source); assert.equal(log[2].source, log[3].source); assert.match(log[0].source, /data:image/);
  invalid = true; const count = log.length; await assert.rejects(callModel(input), /不能重复/); assert.equal(log.length, count + 1, 'bad plan must not write');
  invalid = false; truncated = true; await assert.rejects(callModel(input), /被截断/);
  truncated = false; const fixed = await callModel({ ...input, mode: 'template', outline: ['用户指定'] }); assert.equal(fixed.sections[0].title, '用户指定'); assert.equal(log.at(-1).planning, false);
});
