import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourcePage, findSourceQuote, findSourceBlockRect, imageRectangles } from '../src/sourceLayout.js';

test('locates old text links on the PDF after the duplicate text panel is removed', () => {
  const first = { x: .1, y: .2, width: .3, height: .1 };
  const second = { x: .1, y: .4, width: .4, height: .1 };
  const page = { text: '重复文字\n\n重复文字', blocks: [
    { start: 0, end: 4, rect: first },
    { start: 6, end: 10, rect: second },
  ] };
  assert.deepEqual(findSourceBlockRect(page, '重复文字', 6), second);
  assert.deepEqual(findSourceBlockRect(page, '重 复 文 字'), first);
  assert.equal(findSourceBlockRect(page, '不存在'), null);
});

const item = (str, x, y, width = 45, height = 10) => ({ str, transform: [1, 0, 0, 1, x, y], width, height });

test('rebuilds two columns as separate paragraphs and preserves reading order', () => {
  const items = [];
  for (let n = 0; n < 9; n++) {
    items.push(item(`左栏段落第${n}行文字内容`, 30, 730 - n * 14, 170));
    items.push(item(`右栏段落第${n}行文字内容`, 310, 730 - n * 14, 170));
  }
  const page = buildSourcePage(items, 600, 800);
  assert.equal(page.columns, 2);
  assert.ok(page.text.indexOf('左栏段落第8行') < page.text.indexOf('右栏段落第0行'));
  assert.ok(page.blocks.filter((block) => block.type === 'paragraph').length >= 2);
});

test('keeps equations and embedded images as visual blocks', () => {
  const page = buildSourcePage([
    item('本文介绍检测方法。', 40, 700, 140),
    item('P_d = TP / NP', 130, 650, 100),
    item('下一段文字。', 40, 600, 90),
  ], 600, 800, [{ x: .1, y: .35, width: .5, height: .2 }]);
  assert.deepEqual(page.blocks.map((block) => block.type), ['paragraph', 'formula', 'paragraph', 'image']);
  assert.equal(page.text.slice(page.blocks[1].start, page.blocks[1].end), 'P_d = TP / NP');
});

test('reads embedded image bounds from PDF drawing operations', () => {
  const ops = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintInlineImageXObject: 5, paintJpegXObject: 6 };
  const result = imageRectangles({ fnArray: [1, 3, 4, 2], argsArray: [[], [200, 0, 0, 100, 50, 300], ['img'], []] }, ops, 600, 800);
  assert.deepEqual(result, [{ x: 50 / 600, y: 400 / 800, width: 200 / 600, height: 100 / 800 }]);
});

test('turns a vector figure into an image without swallowing the preceding paragraph', () => {
  const items = [
    item('这是一段正文，', 40, 560, 90), item('正文在图前结束。', 40, 545, 120),
    item('坐标轴', 100, 460, 30), item('0.8', 130, 430, 20),
    item('图', 120, 315, 8), item('1', 130, 315, 6), item('检测曲线', 145, 315, 45),
    item('Fig. 1', 120, 303, 30), item('Detection curve', 155, 303, 85),
    item('图后的正文。', 40, 260, 90),
  ];
  const page = buildSourcePage(items, 600, 800);
  assert.ok(page.text.includes('正文在图前结束。'));
  assert.ok(page.text.includes('图后的正文。'));
  assert.ok(!page.text.includes('坐标轴'));
  assert.match(page.blocks.find((block) => block.type === 'image').label, /^图1\s*检测曲线$/);
});

test('finds a saved quote after PDF whitespace is normalized', () => {
  assert.deepEqual(findSourceQuote('前文\n\n连续性特征，若能充分利用。', '连 续 性 特 征，若能充分利'), { start: 4, end: 15 });
});
