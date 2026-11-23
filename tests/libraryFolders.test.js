import test from 'node:test';
import assert from 'node:assert/strict';
import { createFolder, folderName, folderTarget } from '../src/libraryFolders.js';

test('folder names and targets reject invalid or duplicate values', () => {
  const state = { folders: [] };
  const first = createFolder(state, '  论文  ');
  assert.equal(first.name, '论文');
  assert.equal(folderTarget(state, first.id), first.id);
  assert.equal(folderTarget(state, ''), null);
  assert.throws(() => createFolder(state, '论文'), /已存在/);
  assert.throws(() => createFolder(state, '  '), /名称/);
  assert.throws(() => folderName('a'.repeat(81)), /80/);
  assert.throws(() => folderTarget(state, 'missing'), /不存在/);
});
