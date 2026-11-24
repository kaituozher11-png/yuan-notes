import test from 'node:test';
import assert from 'node:assert/strict';
import { aiNotePresets, aiNoteSections, generationInstruction, normalizeAiAnswer, validateAiGuidance, validateAiOutline, withoutRepeatedTitle } from '../src/aiNoteOutline.js';

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

test('generated and saved notes show one section title while preserving math and internal headings', () => {
  const title = '关键公式与图表';
  const body = '- 图 3 对比两种模型。\n- $E=mc^2$\n\n### 推导步骤\n正文\n\n### 关键公式与图表\n引用小节';
  for (const heading of ['### 关键公式与图表', '**关键公式与图表**', '关键公式与图表：', '关键公式与图表\n---', '## **关键公式与图表** ##']) {
    const saved = { sections: [{ title, content: `\n${heading}\n\n${body}` }] };
    const before = JSON.stringify(saved);
    assert.equal(normalizeAiAnswer(saved, [title]).sections[0].content, body);
    assert.equal(aiNoteSections(saved)[0].value, body);
    assert.equal(aiNoteSections(saved)[0].sourceValue, saved.sections[0].content);
    assert.equal(JSON.stringify(saved), before, 'reading old notes must not overwrite saved content');
  }
  assert.equal(withoutRepeatedTitle(`### ${title}\r\n\r\n### ${title}\r\n${body}`, title), body);
  assert.equal(withoutRepeatedTitle(body, title), body);
  for (const content of ['### 不同标题\n正文', '关键公式与图表说明如下', '```\n关键公式与图表\n```', '$E=mc^2$', '   保留正文缩进']) {
    assert.equal(withoutRepeatedTitle(content, title), content);
  }
  assert.equal(withoutRepeatedTitle(`### ${title}`, title), '');
  assert.equal(withoutRepeatedTitle(body, ''), body);
  assert.equal(withoutRepeatedTitle(`### ${title}\n\n    缩进代码`, title), '    缩进代码');
});

test('legacy list notes remove only leading repeated section labels', () => {
  const items = ['### 核心概念', '**核心概念**\n\n概念说明', '### 核心概念\n正文引用'];
  const sections = aiNoteSections({ concepts: items });
  assert.deepEqual(sections[0].value, ['概念说明', '### 核心概念\n正文引用']);
  assert.deepEqual(sections[0].sourceValue, items);
  assert.deepEqual(items, ['### 核心概念', '**核心概念**\n\n概念说明', '### 核心概念\n正文引用']);
});
