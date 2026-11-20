import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function launch(t, overrides) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yingxing-lan-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      PORT: String(port), YINGXING_DATA_DIR: directory,
      YINGXING_PUBLIC: '1', YINGXING_PUBLIC_ORIGIN: `http://192.168.1.8:${port}`,
      YINGXING_BIND_HOST: '127.0.0.1', YINGXING_LAN_TEST: '1',
      ...overrides,
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exit = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exit;
    }
    await rm(directory, { recursive: true, force: true });
  });
  return child;
}

test('LAN HTTP requires an explicit switch and matching private bind address', async (t) => {
  const child = await launch(t);
  await new Promise((resolve) => child.once('exit', resolve));
  assert.notEqual(child.exitCode, 0);
});

test('LAN HTTP refuses a public address even with the test switch', async (t) => {
  const child = await launch(t, { YINGXING_PUBLIC_ORIGIN: 'http://8.8.8.8:4187', YINGXING_BIND_HOST: '8.8.8.8' });
  await new Promise((resolve) => child.once('exit', resolve));
  assert.notEqual(child.exitCode, 0);
});
