import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestTextRun, selectionColumnBounds, selectVisibleText } from '../src/pdfTextSelection.js';

const page = { left: 100, right: 700, width: 600, height: 800 };
const run = (id, text, left, right, top, bottom) => ({
  id, text, rect: { left, right, top, bottom, width: right - left, height: bottom - top },
});
const columns = [
  run('right1', 'right first', 410, 650, 10, 20),
  run('left2', 'left second', 110, 350, 30, 40),
  run('left1', 'left first', 110, 350, 11, 21),
  run('right2', 'right second', 410, 650, 29, 39),
];

test('detects columns from rendered text, even before page analysis finishes', () => {
  assert.deepEqual(selectionColumnBounds(page, columns[2].rect, columns), { left: 100, right: 399 });
  assert.deepEqual(selectionColumnBounds(page, columns[0].rect, columns), { left: 401, right: 700 });
  assert.deepEqual(selectionColumnBounds(page, columns[0].rect, [columns[0], columns[2]]), { left: 401, right: 700 });
});

test('keeps full-width headings and genuine one-column pages selectable', () => {
  assert.deepEqual(selectionColumnBounds(page, { left: 200, right: 600, width: 400 }, columns), { left: 100, right: 700 });
  assert.deepEqual(selectionColumnBounds(page, columns[2].rect, [run('body', 'one column', 110, 650, 10, 20)]), { left: 100, right: 700 });
  const title = run('title', 'title text', 260, 490, 200, 215);
  const distantColumns = [run('distant-left', 'left footer', 110, 350, 600, 610),
    run('distant-right', 'right footer', 410, 650, 600, 610)];
  assert.deepEqual(selectionColumnBounds(page, title.rect, [title, ...distantColumns]), { left: 100, right: 700 });
});

test('does not mistake a nearby left line for right text in the gap between rows', () => {
  const staggered = [run('left', 'left', 110, 350, 20, 30), run('right', 'right', 410, 650, 10, 20)];
  assert.equal(nearestTextRun(staggered, 430, 23, { left: 100, right: 700 }).run.id, 'right');
  assert.equal(nearestTextRun(staggered, 398, 15, { left: 100, right: 700 }).run.id, 'right');
});

test('selects only the right column across staggered rows and reverses correctly', () => {
  const right = selectionColumnBounds(page, columns[0].rect, columns);
  assert.equal(selectVisibleText(columns, { id: 'right1', offset: 2 }, { id: 'right2', offset: 5 }, right).text,
    'ght first\nright');
  assert.equal(selectVisibleText(columns, { id: 'right2', offset: 5 }, { id: 'right1', offset: 2 }, right).text,
    'ght first\nright');
});

test('excludes a left span that overhangs the column boundary', () => {
  const overhang = run('left-overhang', 'unrelated left', 110, 402, 30, 40);
  const right = { left: 401, right: 700 };
  assert.equal(nearestTextRun([overhang, columns[3]], 420, 35, right).run.id, 'right2');
  assert.equal(selectVisibleText([columns[0], overhang, columns[3]],
    { id: 'right1', offset: 0 }, { id: 'right2', offset: 5 }, right).text,
    'right first\nright');
});

test('selects by visible line order when PDF spans have unrelated DOM order', () => {
  const runs = [
    { id: 'right', text: 'unrelated right column', rect: { left: 410, right: 590, top: 10, bottom: 20, width: 180, height: 10 } },
    { id: 'third', text: 'third line', rect: { left: 110, right: 200, top: 40, bottom: 50, width: 90, height: 10 } },
    { id: 'first', text: 'first line', rect: { left: 110, right: 200, top: 10, bottom: 20, width: 90, height: 10 } },
    { id: 'second', text: 'second line', rect: { left: 110, right: 220, top: 25, bottom: 35, width: 110, height: 10 } },
  ];
  const left = { left: 100, right: 399 };
  assert.equal(selectVisibleText(runs, { id: 'first', offset: 2 }, { id: 'first', offset: 7 }, left).text, 'rst l');
  assert.equal(selectVisibleText(runs, { id: 'first', offset: 0 }, { id: 'third', offset: 5 }, left).text, 'first line\nsecond line\nthird');
  assert.equal(selectVisibleText(runs, { id: 'third', offset: 5 }, { id: 'first', offset: 0 }, left).text, 'first line\nsecond line\nthird');
  assert.deepEqual(selectVisibleText(runs, { id: 'right', offset: 0 }, { id: 'third', offset: 4 }, left), { text: '', segments: [] });
});
