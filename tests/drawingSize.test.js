import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DRAWING_HEIGHT, MAX_DRAWING_HEIGHT, drawingHeight, nextDrawingHeight } from '../src/drawingSize.js';

test('keeps old drawings at their original height and extends in fixed steps', () => {
  assert.equal(drawingHeight(undefined), DEFAULT_DRAWING_HEIGHT);
  assert.equal(drawingHeight(100), DEFAULT_DRAWING_HEIGHT);
  assert.equal(nextDrawingHeight(undefined), 660);
  assert.equal(nextDrawingHeight(660), 900);
  assert.equal(nextDrawingHeight(MAX_DRAWING_HEIGHT), MAX_DRAWING_HEIGHT);
  assert.equal(drawingHeight(MAX_DRAWING_HEIGHT + 1000), MAX_DRAWING_HEIGHT);
});
