import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import { parseFormulaEntry } from '../src/formulas.js';

test('renders a saved network equation as structured math without changing its meaning', () => {
  const parts = parseFormulaEntry('W1 = ReLU(BN(fconv_{3×3}(F)))');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, 'math');
  assert.match(parts[0].value, /W_1/);
  assert.match(parts[0].value, /\\operatorname\{fconv\}_\{3\\times 3\}/);
  assert.doesNotThrow(() => katex.renderToString(parts[0].value, { throwOnError: true }));
});

test('keeps explanations separate and never guesses an absent equation', () => {
  const parts = parseFormulaEntry('W3、W4：在分支卷积中使用 3×3 空洞卷积；具体嵌套次序请对照原文公式核对。');
  assert.deepEqual(parts.map((part) => part.type), ['text', 'text']);
  const mixed = parseFormulaEntry('Pd = TP / NP，其中 TP 为正确检测数。');
  assert.deepEqual(mixed.map((part) => part.type), ['math', 'text']);
  assert.equal(mixed[1].value, '其中 TP 为正确检测数。');
});

test('preserves explicit LaTeX and separates several equations', () => {
  const parts = parseFormulaEntry('解码器：$W_1=\\operatorname{ReLU}(F)$；$W_2=\\frac{a}{b}$');
  assert.deepEqual(parts.map((part) => part.type), ['text', 'math', 'math']);
  for (const part of parts.filter((item) => item.type === 'math')) assert.doesNotThrow(() => katex.renderToString(part.value, { throwOnError: true }));
});
