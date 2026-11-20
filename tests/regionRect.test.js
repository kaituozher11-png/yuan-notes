import test from 'node:test';
import assert from 'node:assert/strict';
import { moveRegionRect, resizeRegionRect } from '../src/regionRect.js';

const rect = { x: .25, y: .3, width: .4, height: .2 };

test('moves a selected region without letting it leave the source page', () => {
  const moved = moveRegionRect(rect, .1, -.1);
  assert.ok(Math.abs(moved.x - .35) < 1e-9);
  assert.ok(Math.abs(moved.y - .2) < 1e-9);
  assert.equal(moved.width, .4);
  assert.equal(moved.height, .2);
  assert.deepEqual(moveRegionRect(rect, 2, 2), { x: .6, y: .8, width: .4, height: .2 });
  assert.deepEqual(moveRegionRect(rect, -2, -2), { x: 0, y: 0, width: .4, height: .2 });
});

test('resizes corners and edges while preserving a usable minimum area', () => {
  assert.deepEqual(resizeRegionRect(rect, 'se', { x: .8, y: .75 }), { x: .25, y: .3, width: .55, height: .45 });
  const minimum = resizeRegionRect(rect, 'nw', { x: 1, y: 1 });
  assert.ok(Math.abs(minimum.width - .015) < 1e-9);
  assert.ok(Math.abs(minimum.height - .015) < 1e-9);
  assert.deepEqual(resizeRegionRect(rect, 'w', { x: -.5, y: .5 }), { x: 0, y: .3, width: .65, height: .2 });
  assert.deepEqual(resizeRegionRect(rect, 'e', { x: 2, y: .5 }), { x: .25, y: .3, width: .75, height: .2 });
});
