import test from 'node:test';
import assert from 'node:assert/strict';
import { blockToRich, blocksToRich, freeNoteBlocks, partsToRich, richText } from '../src/richDocument.js';

test('old text, formula, and image become one ordered rich document', () => {
  const doc = partsToRich([
    { id: 'a', type: 'text', text: '前文' },
    { id: 'b', type: 'formula', text: 'x^2' },
    { id: 'c', type: 'text', text: '后文' },
    { id: 'd', type: 'image', data: '/api/images/a.png', text: '图', width: 40, align: 'right' },
    { id: 'e', type: 'text', text: '下一段' },
  ]);
  assert.deepEqual(doc.content.map((node) => node.type), ['paragraph']);
  assert.deepEqual(doc.content[0].content.map((node) => node.type), ['text', 'formulaInline', 'text', 'noteImage', 'text']);
  assert.equal(doc.content[0].content[3].attrs.width, 40);
  assert.equal(doc.content[0].content[3].attrs.align, 'right');
  assert.match(richText(doc), /前文.*x\^2.*后文.*图.*下一段/);
});

test('keeps newlines and trailing typing space across old media', () => {
  const doc = partsToRich([{ type: 'text', text: '甲\n乙' }, { type: 'image', data: '/a.png' }]);
  assert.deepEqual(doc.content.map((node) => node.type), ['paragraph']);
  assert.equal(doc.content[0].content[1].type, 'hardBreak');
  assert.deepEqual(blockToRich({ type: 'mixed', rich: doc, parts: [] }), doc);
  assert.deepEqual(partsToRich([]), { type: 'doc', content: [{ type: 'paragraph' }] });
});

test('combines separate legacy free-note blocks into one editor document', () => {
  const doc = blocksToRich([
    { type: 'text', text: '文字' },
    { type: 'formula', text: 'x^2' },
    { type: 'image', data: '/api/images/a.png', width: 50 },
  ]);
  assert.deepEqual(doc.content.map((node) => node.type), ['paragraph', 'paragraph', 'paragraph']);
  assert.equal(doc.content[1].content[0].type, 'formulaInline');
  assert.equal(doc.content[2].content[0].type, 'noteImage');
});

test('keeps a legacy image beside following text without an empty paragraph', () => {
  const doc = blocksToRich([
    { type: 'image', data: '/api/images/a.png' },
    { type: 'text', text: '图片说明' },
  ]);
  assert.deepEqual(doc.content.map((node) => node.type), ['paragraph', 'paragraph']);
  assert.equal(doc.content[0].content[0].type, 'noteImage');
  assert.equal(doc.content[1].content[0].text, '图片说明');
});

test('moves a saved block image into the following editable paragraph', () => {
  const doc = blockToRich({ type: 'mixed', rich: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '前文' }] },
    { type: 'noteImage', attrs: { src: '/a.png', width: 40, align: 'left' } },
    { type: 'paragraph', content: [{ type: 'text', text: '后文' }] },
  ] } });
  assert.deepEqual(doc.content.map((node) => node.type), ['paragraph', 'paragraph']);
  assert.deepEqual(doc.content[1].content.map((node) => node.type), ['noteImage', 'text']);
  assert.equal(doc.content[1].content[1].text, '后文');
});

test('lifts existing embedded maps into separate blocks without losing surrounding text', () => {
  const blocks = freeNoteBlocks([{ id: 'note', type: 'mixed', rich: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '前文' }] },
    { type: 'noteMindMap', attrs: { nodes: [{ id: 'root', text: '主题' }] } },
    { type: 'paragraph', content: [{ type: 'text', text: '后文' }] },
  ] } }]);
  assert.deepEqual(blocks.map((block) => block.type), ['mixed', 'mindmap', 'mixed']);
  assert.equal(blocks[0].rich.content[0].content[0].text, '前文');
  assert.equal(blocks[1].nodes[0].text, '主题');
  assert.equal(blocks[2].rich.content[0].content[0].text, '后文');
  assert.equal(new Set(blocks.map((block) => block.id)).size, 3);
});
