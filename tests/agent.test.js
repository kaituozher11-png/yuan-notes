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
