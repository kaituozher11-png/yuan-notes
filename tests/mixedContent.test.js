import test from 'node:test';
import assert from 'node:assert/strict';
import { insertMixedPart, removeMixedPart } from '../src/mixedContent.js';

test('inserts a formula at the text cursor and preserves text on both sides', () => {
  const parts = [{ id: 'text', type: 'text', text: '前文后文' }];
  const formula = { id: 'formula', type: 'formula', text: 'x^2' };
  const result = insertMixedPart(parts, formula, { partId: 'text', start: 2, end: 2 });
  assert.deepEqual(result.parts.map((part) => [part.type, part.text]), [['text', '前文'], ['formula', 'x^2'], ['text', '后文']]);
  assert.equal(result.focusId, result.parts[2].id);
  assert.deepEqual(parts, [{ id: 'text', type: 'text', text: '前文后文' }]);
});

test('replaces selected text and keeps a writable text part after an image', () => {
  const image = { id: 'image', type: 'image', data: '/api/images/example.png', text: '示意图' };
  const result = insertMixedPart([{ id: 'text', type: 'text', text: '错误结论' }], image, { partId: 'text', start: 0, end: 2 });
  assert.deepEqual(result.parts.map((part) => [part.type, part.text]), [['image', '示意图'], ['text', '结论']]);
  const next = insertMixedPart(result.parts, { id: 'formula', type: 'formula', text: '' }, { partId: 'image' });
  assert.deepEqual(next.parts.map((part) => part.type), ['image', 'formula', 'text']);
});

test('appends after a missing cursor and keeps the editor usable after deleting everything', () => {
  const result = insertMixedPart([], { id: 'formula', type: 'formula', text: '' }, null);
  assert.deepEqual(result.parts.map((part) => part.type), ['formula', 'text']);
  const remaining = removeMixedPart(result.parts, 'formula');
  assert.deepEqual(remaining.map((part) => part.type), ['text']);
  assert.deepEqual(removeMixedPart(remaining, remaining[0].id).map((part) => part.type), ['text']);
});
