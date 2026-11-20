import http from 'node:http';

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (req.headers.authorization !== 'Bearer test-only-key') { res.writeHead(401).end('{}'); return; }
  if (body.model === 'missing-model') {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Model missing-model does not exist' } }));
    return;
  }
  const user = body.messages?.[1]?.content;
  const text = typeof user === 'string' ? user : user?.[0]?.text || '';
  const content = text === '连接测试' ? 'OK' : JSON.stringify({
    summary: '本页介绍守恒规律。',
    concepts: ['能量在系统中发生转化。'],
    important: ['先明确系统边界。'],
    cautions: ['不要混淆能量转移与转化。'],
    formula: [],
    quiz: ['守恒规律成立的条件是什么？']
  });
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
});
server.listen(4789, '127.0.0.1', () => console.log('Mock model ready on 4789'));
