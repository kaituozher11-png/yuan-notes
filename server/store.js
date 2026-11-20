import fs from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

export const dataDir = path.resolve(process.env.YINGXING_DATA_DIR || 'data');
const requestScope = new AsyncLocalStorage();
const states = new Map();
const writes = new Map();

export function getDataDir() { return requestScope.getStore()?.dir || dataDir; }
export function currentUserId() { return requestScope.getStore()?.userId || null; }

export function runForUser(userId, callback) {
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error('账号标识无效');
  return requestScope.run({ userId, dir: path.join(dataDir, 'users', userId) }, callback);
}

async function loadState(dir) {
  await fs.mkdir(dir, { recursive: true });
  let state;
  try { state = JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { docs: [], notes: [], templates: [] };
  }
  state.docs ||= []; state.notes ||= []; state.templates ||= [];
  const orderByPage = new Map();
  for (const note of state.notes) {
    const key = `${note.docId}:${note.page}`;
    const next = orderByPage.get(key) || 1;
    if (!Number.isFinite(note.order)) note.order = note.kind === 'ai' ? 0 : next;
    if (note.kind !== 'ai') orderByPage.set(key, Math.max(next, note.order + 1));
  }
  return state;
}

export async function getState() {
  const dir = getDataDir();
  if (!states.has(dir)) {
    states.set(dir, loadState(dir).catch((error) => { states.delete(dir); throw error; }));
  }
  return states.get(dir);
}

export async function mutate(change) {
  const dir = getDataDir();
  const current = await getState();
  const result = change(current);
  const snapshot = JSON.stringify(current, null, 2);
  const next = (writes.get(dir) || Promise.resolve()).catch(() => {}).then(async () => {
    const file = path.join(dir, 'state.json');
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, snapshot, 'utf8');
    await fs.rename(temp, file);
  });
  writes.set(dir, next);
  await next;
  return result;
}

export function clearUserState(userId) {
  const dir = path.join(dataDir, 'users', userId);
  states.delete(dir);
  writes.delete(dir);
}

export function resetStoreForTests() { states.clear(); writes.clear(); }
