import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMarkup } from '../server/markup.js';

test('accepts page-relative ink and movable, collapsible sticky notes', () => {
  const markup = { strokes: [
    { tool: 'pen', color: '#d64545', size: 3, points: [[0, 0], [1, 1]] },
    { tool: 'highlighter', color: '#e9bd45', size: 16, points: [[.3, .2]] },
    { tool: 'eraser', color: '#d64545', size: 20, points: [[.5, .5]] },
  ], stickies: [{ id: 'sticky-1', x: .7, y: .9, text: '复习公式', collapsed: true }] };
  assert.deepEqual(validateMarkup(markup), markup);
});

test('rejects invalid coordinates and oversized sticky content', () => {
  assert.throws(() => validateMarkup({ strokes: [{ tool: 'pen', color: '#d64545', size: 3, points: [[-1, .2]] }], stickies: [] }), /笔迹数据无效/);
  assert.throws(() => validateMarkup({ strokes: [], stickies: [{ id: 'a', x: .2, y: 1.2, text: '', collapsed: false }] }), /便利贴数据无效/);
  assert.throws(() => validateMarkup({ strokes: [], stickies: [{ id: 'a', x: .2, y: .2, text: 'x'.repeat(2001), collapsed: false }] }), /便利贴数据无效/);
});
