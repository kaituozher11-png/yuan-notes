import test from 'node:test';
import assert from 'node:assert/strict';
import { clampNoteWidth, noteWidthLimits } from '../src/notePaneLayout.js';

test('keeps a useful minimum width for both panels on desktop', () => {
  assert.deepEqual(noteWidthLimits(1000, false), { min: 320, max: 668 });
  assert.equal(clampNoteWidth(440, 1000, false), 440);
  assert.equal(clampNoteWidth(900, 1000, false), 668);
  assert.equal(clampNoteWidth(100, 1000, false), 320);
});

test('keeps the source visible beside the note drawer on narrow screens', () => {
  assert.deepEqual(noteWidthLimits(744, true), { min: 220, max: 397 });
  assert.deepEqual(noteWidthLimits(534, true), { min: 220, max: 388 });
  assert.deepEqual(noteWidthLimits(337, true), { min: 220, max: 313 });
  assert.equal(clampNoteWidth(440, 337, true), 313);
  assert.deepEqual(noteWidthLimits(267, true), { min: 220, max: 243 });
  assert.equal(clampNoteWidth(240, 337, true), 240);
});
