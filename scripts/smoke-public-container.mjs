import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const origin = process.argv[2] || 'http://127.0.0.1:4186';
const container = process.argv[3] || 'yingxing-release-smoke-20261116';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) {
  throw new Error('容器验收只允许在本机测试地址运行');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function request(route, { cookie, method = 'GET', body, json } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (method !== 'GET') headers['X-Yingxing-Request'] = '1';
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const response = await fetch(`${origin}${route}`, { method, headers, body, signal: AbortSignal.timeout(130000) });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const { response } = await request('/api/health');
      if (response.ok) return;
    } catch { /* The container may still be starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('容器健康检查超时');
}

async function register(suffix) {
  const result = await request('/api/auth/register', {
    method: 'POST', json: { username: `smoke_${suffix}`, password: 'ContainerSmokePassword-1234' },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.ok(result.cookie);
  return result.cookie;
}

async function upload(cookie, filename, type) {
  const form = new FormData();
  form.set('file', new File([await fs.readFile(path.join(root, 'test-output', filename))], filename, { type }));
  const result = await request('/api/docs', { cookie, method: 'POST', body: form });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.ok(result.data.pages >= 1);
  return result.data;
}

await ready();
const suffix = Date.now().toString(36);
const alice = await register(`${suffix}_a`);
const bob = await register(`${suffix}_b`);
const word = await upload(alice, 'sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
const pdf = await upload(bob, 'sample.pdf', 'application/pdf');

const note = await request('/api/notes', {
  cookie: alice, method: 'POST', json: { docId: word.id, page: 1, title: '容器验收笔记' },
});
assert.equal(note.response.status, 200, JSON.stringify(note.data));
const imageForm = new FormData();
imageForm.set('image', new File([await fs.readFile(path.join(root, 'public', 'icons', 'icon-192.png'))], 'icon.png', { type: 'image/png' }));
const image = await request('/api/images', { cookie: alice, method: 'POST', body: imageForm });
assert.equal(image.response.status, 200, JSON.stringify(image.data));
assert.equal((await request(`/api/docs/${word.id}/pdf`, { cookie: bob })).response.status, 404);
assert.equal((await request(image.data.url, { cookie: bob })).response.status, 404);
assert.equal((await request(`/api/docs/${word.id}/pages/1/text`, { cookie: alice })).response.status, 200);
const preview = await request(`/api/docs/${word.id}/pdf`, { cookie: alice });
assert.equal(preview.response.status, 200);
assert.equal(Buffer.from(await preview.response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

await run('docker', ['restart', container]);
await ready();
const aliceState = await request('/api/state', { cookie: alice });
const bobState = await request('/api/state', { cookie: bob });
assert.equal(aliceState.response.status, 200);
assert.equal(bobState.response.status, 200);
assert.ok(aliceState.data.docs.some((item) => item.id === word.id));
assert.ok(aliceState.data.notes.some((item) => item.id === note.data.id));
assert.ok(bobState.data.docs.some((item) => item.id === pdf.id));
assert.ok(!bobState.data.docs.some((item) => item.id === word.id));
assert.equal((await request(image.data.url, { cookie: alice })).response.status, 200);
console.log('容器验收通过：双账号隔离、Word/PDF 导入、图片与笔记、重启后持久保存。');
