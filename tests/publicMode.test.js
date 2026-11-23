import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { publicModelAddress } from '../server/model-network.js';

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
    '<< /Length 46 >>\nstream\nBT /F1 18 Tf 70 720 Td (Study page) Tj ET\nendstream',
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

test('public mode keeps accounts, files, notes and sessions separate', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yingxing-public-test-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PORT: String(port), YINGXING_DATA_DIR: directory,
      YINGXING_PUBLIC: '1', YINGXING_PUBLIC_ORIGIN: origin, YINGXING_PUBLIC_ALLOW_HTTP: '1', YINGXING_TRUST_PROXY: '1' },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });
  async function request(route, { cookie, method = 'GET', body, headers = {}, verified = true } = {}) {
    const response = await fetch(`${origin}${route}`, {
      method, body,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(!['GET', 'HEAD'].includes(method) && verified ? { 'X-Yingxing-Request': '1' } : {}), ...headers },
    });
    return { status: response.status, body: await response.json().catch(() => null), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await request('/api/health')).status === 200) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'public server started');
  assert.equal((await request('/api/state')).status, 401);
  assert.equal((await request('/api/auth/session')).body.mode, 'public');

  const register = (username, password) => request('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  const a = await register('student_alpha', 'AlphaPassword-1234');
  const b = await register('student_beta', 'BetaPassword-1234');
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.notEqual(a.body.user.id, b.body.user.id);
  assert.equal(a.body.recoveryCode.length, 32);
  const localModel = await request('/api/models/test', {
    cookie: a.cookie, method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://127.0.0.1/v1', model: 'test', key: 'test-key' }),
  });
  assert.equal(localModel.status, 400);
  assert.match(localModel.body.error, /公网 HTTPS/);
  assert.equal((await request('/api/auth/register', { method: 'POST', verified: false, headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await request('/api/state', { cookie: a.cookie, headers: { Origin: 'https://foreign.example' } })).status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    http.get(`${origin}/api/state`, { headers: { Host: 'foreign.example', Cookie: a.cookie } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(wrongHost, 403);

  const form = new FormData();
  form.append('file', new Blob([samplePdf()], { type: 'application/pdf' }), 'private-alpha.pdf');
  const imported = await request('/api/docs', { cookie: a.cookie, method: 'POST', body: form });
  assert.equal(imported.status, 200);
  const docId = imported.body.id;
  const folderA = await request('/api/folders', { cookie: a.cookie, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '论文' }) });
  const folderB = await request('/api/folders', { cookie: b.cookie, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '论文' }) });
  assert.equal(folderA.status, 200);
  assert.equal(folderB.status, 200);
  assert.notEqual(folderA.body.id, folderB.body.id);
  assert.equal((await request(`/api/docs/${docId}`, { cookie: a.cookie, method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: folderB.body.id }) })).status, 400);
  assert.equal((await request(`/api/docs/${docId}`, { cookie: a.cookie, method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: folderA.body.id }) })).status, 200);
  assert.equal((await request('/api/state', { cookie: b.cookie })).body.folders.length, 1);
  assert.equal((await request('/api/state', { cookie: a.cookie })).body.docs.length, 1);
  assert.equal((await request('/api/state', { cookie: b.cookie })).body.docs.length, 0);
  const documentResponse = await fetch(`${origin}/api/docs/${docId}/pdf`, { headers: { Cookie: b.cookie } });
  assert.equal(documentResponse.status, 404);
  const note = await request('/api/notes', { cookie: a.cookie, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId, page: 1 }) });
  assert.equal(note.status, 200);
  assert.equal((await request('/api/notes', { cookie: b.cookie, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId, page: 1 }) })).status, 400);
  assert.equal((await request(`/api/notes/${note.body.id}`, { cookie: b.cookie, method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'stolen' }) })).status, 400);
  assert.equal((await request('/api/state', { cookie: a.cookie })).body.notes[0].title, '我的补充');

  assert.equal((await request('/api/auth/logout', { cookie: a.cookie, method: 'POST', body: '{}' })).status, 200);
  assert.equal((await request('/api/state', { cookie: a.cookie })).status, 401);
  const recovered = await request('/api/auth/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'student_alpha', recoveryCode: a.body.recoveryCode, password: 'NewPassword-5678' }) });
  assert.equal(recovered.status, 200);
  assert.equal((await request('/api/state', { cookie: recovered.cookie })).body.docs.length, 1);
  assert.equal((await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'student_alpha', password: 'AlphaPassword-1234' }) })).status, 400);
  assert.equal((await request('/api/auth/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'student_alpha', recoveryCode: a.body.recoveryCode, password: 'AnotherPassword-5678' }) })).status, 400);
  assert.equal((await request('/api/auth/account', { cookie: recovered.cookie, method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'NewPassword-5678' }) })).status, 200);
  assert.equal((await request('/api/state', { cookie: recovered.cookie })).status, 401);
  assert.equal((await request('/api/state', { cookie: b.cookie })).body.docs.length, 0);

  const invalidLogin = (ip, username) => request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ username, password: 'invalid' }),
  });
  for (let i = 0; i < 15; i++) assert.equal((await invalidLogin('198.51.100.10', 'missing_user')).status, 400);
  assert.equal((await invalidLogin('198.51.100.10', 'missing_user')).status, 429);
  assert.equal((await invalidLogin('198.51.100.11', 'missing_user')).status, 400);
  for (let i = 0; i < 29; i++) assert.equal((await request('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.12' },
    body: JSON.stringify({ username: `x${i}`, password: 'invalid' }),
  })).status, 400);
  assert.equal((await request('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.12' },
    body: JSON.stringify({ username: 'x29', password: 'invalid' }),
  })).status, 400);
  assert.equal((await request('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.12' },
    body: JSON.stringify({ username: 'x30', password: 'invalid' }),
  })).status, 429);
});

test('public model addresses reject local, reserved and private targets', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.2.3', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1']) {
    assert.equal(publicModelAddress(address), false, address);
  }
  assert.equal(publicModelAddress('8.8.8.8'), true);
});
