import test from 'node:test';
import assert from 'node:assert/strict';
import { aiNotePresets, aiNoteSections, generationInstruction, normalizeAiAnswer, validateAiGuidance, validateAiOutline } from '../src/aiNoteOutline.js';

test('paper and course presets provide distinct editable headings', () => {
  assert.ok(aiNotePresets.paper.titles.length >= 4);
  assert.ok(aiNotePresets.course.titles.length >= 4);
  assert.notDeepEqual(aiNotePresets.paper.titles, aiNotePresets.course.titles);
  assert.deepEqual(validateAiOutline([' 自定义标题 ', '新增内容']), ['自定义标题', '新增内容']);
  for (const outline of [[], [''], ['重复', '重复'], Array(13).fill('x'), ['x'.repeat(61)]]) {
    assert.throws(() => validateAiOutline(outline));
  }
});

test('generation uses requested order and keeps custom titles in saved result', () => {
  const titles = ['研究方法', '我想核对的结论'];
  const prompt = generationInstruction(3, titles, '重点解释推导');
  assert.ok(prompt.includes(JSON.stringify(titles)));
  assert.match(prompt, /重点解释推导/);
  assert.equal(validateAiGuidance('  聚焦图表  '), '聚焦图表');
  assert.throws(() => validateAiGuidance('x'.repeat(1001)), /1000/);
  const result = normalizeAiAnswer({ sections: [{ title: '模型乱改的标题', content: '方法说明' }, { content: '待核对' }] }, titles);
  assert.deepEqual(result, { sections: [{ title: '研究方法', content: '方法说明' }, { title: '我想核对的结论', content: '待核对' }] });
  assert.deepEqual(aiNoteSections(result).map(({ title }) => title), titles);
  assert.equal(aiNoteSections({ sections: [{ title: '', content: 'draft' }] }).length, 1);
  assert.throws(() => normalizeAiAnswer({ sections: [{ content: '只有一项' }] }, titles), /完整笔记/);
  assert.throws(() => normalizeAiAnswer({ sections: [{ content: '一' }, { content: 3 }] }, titles), /完整笔记/);
});

test('older generated notes retain their original headings', () => {
  const sections = aiNoteSections({ summary: '概览', concepts: ['概念'], formula: ['$E=mc^2$'] });
  assert.deepEqual(sections.map(({ title }) => title), ['这页讲什么', '核心概念', '公式与图表']);
  assert.equal(normalizeAiAnswer({ summary: '旧笔记', evidence: ['remove'] }).evidence, undefined);
});
