import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeUploadFilename, repairedDocumentName } from '../server/filenames.js';

test('recovers UTF-8 Chinese filenames decoded as Latin-1', () => {
  const filename = '低信噪比下面向时空特征融合的雷达目标智能检测方法_陈垣光.pdf';
  const garbled = Buffer.from(filename, 'utf8').toString('latin1');
  assert.equal(decodeUploadFilename(garbled), filename);
  assert.deepEqual(repairedDocumentName({ filename: garbled, name: garbled.slice(0, -4) }), { filename, name: filename.slice(0, -4) });
});

test('keeps already decoded, ASCII, and invalid UTF-8 filenames', () => {
  for (const filename of ['讲义.pdf', 'notes.pdf', 'café.pdf']) assert.equal(decodeUploadFilename(filename), filename);
  assert.equal(repairedDocumentName({ filename: '讲义.pdf', name: '我的资料' }), null);
});

test('preserves a title edited by the user while repairing the original filename', () => {
  const filename = Buffer.from('讲义.pdf', 'utf8').toString('latin1');
  assert.deepEqual(repairedDocumentName({ filename, name: '期末复习' }), { filename: '讲义.pdf', name: '期末复习' });
});
