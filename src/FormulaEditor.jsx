import { useEffect, useRef, useState } from 'react';
import { MathfieldElement } from 'mathlive';
import 'mathlive/fonts.css';
import katex from 'katex';
import { MathDisplay } from './FormulaDisplay';

MathfieldElement.fontsDirectory = null;
MathfieldElement.locale = 'zh-cn';
MathfieldElement.strings = { 'zh-cn': {
  'tooltip.cut to clipboard': '剪切到剪贴板',
  'tooltip.paste from clipboard': '从剪贴板粘贴',
  'tooltip.menu': '菜单',
  'menu.insert': '插入',
  'menu.insert.abs': '绝对值',
  'menu.insert.nth-root': 'n 次根式',
  'menu.insert.log-base': '以 a 为底的对数',
  'menu.insert.heading-calculus': '微积分',
  'menu.insert.derivative': '导数',
  'menu.insert.nth-derivative': 'n 阶导数',
  'menu.insert.integral': '积分',
  'menu.insert.sum': '求和',
  'menu.insert.product': '连乘',
  'menu.insert.heading-complex-numbers': '复数',
  'menu.insert.modulus': '模',
  'menu.insert.argument': '辐角',
  'menu.insert.real-part': '实部',
  'menu.insert.imaginary-part': '虚部',
  'menu.insert.conjugate': '共轭',
  'menu.copy-as-typst': '复制为 Typst',
  'menu.array.add row above': '在上方添加行',
  'menu.array.add row below': '在下方添加行',
  'menu.array.add column before': '在左侧添加列',
  'menu.array.add column after': '在右侧添加列',
} };

const structures = [
  { label: '分数', symbol: 'a/b', latex: '\\frac{\\placeholder{a}}{\\placeholder{b}}' },
  { label: '上标', symbol: 'x²', latex: '^{\\placeholder{2}}' },
  { label: '下标', symbol: 'xₙ', latex: '_{\\placeholder{n}}' },
  { label: '根号', symbol: '√', latex: '\\sqrt{\\placeholder{x}}' },
  { label: '求和', symbol: '∑', latex: '\\sum_{\\placeholder{i=1}}^{\\placeholder{n}}' },
  { label: '积分', symbol: '∫', latex: '\\int_{\\placeholder{a}}^{\\placeholder{b}}' },
  { label: '括号', symbol: '( )', latex: '\\left(\\placeholder{x}\\right)' },
  { label: '希腊字母', symbol: 'α', latex: '\\alpha' },
  { label: '乘号', symbol: '×', latex: '\\times' },
  { label: '矩阵', symbol: '[ ]', latex: '\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}' },
];

export default function FormulaEditor({ value = '', onChange, label = '公式编辑器', autoFocus = false }) {
  const mount = useRef(null);
  const field = useRef(null);
  const latestChange = useRef(onChange);
  const [sourceOpen, setSourceOpen] = useState(false);
  latestChange.current = onChange;
  let formulaError = '';
  if (value.includes('\\placeholder')) {
    formulaError = '请填完公式中的空位';
  } else if (value.trim()) {
    try { katex.renderToString(value, { throwOnError: true, trust: false }); }
    catch { formulaError = '公式语法有误，请检查 LaTeX 输入'; }
  }

  useEffect(() => {
    const element = new MathfieldElement();
    element.setAttribute('aria-label', label);
    element.mathVirtualKeyboardPolicy = 'auto';
    element.smartFence = true;
    element.value = value;
    const handleInput = () => latestChange.current(element.value);
    element.addEventListener('input', handleInput);
    mount.current.append(element);
    field.current = element;
    if (autoFocus) requestAnimationFrame(() => element.focus());
    return () => { element.removeEventListener('input', handleInput); element.remove(); field.current = null; };
  }, []);

  useEffect(() => { if (field.current && field.current.value !== value) field.current.value = value; }, [value]);

  function insert(latex) {
    field.current?.focus();
    field.current?.insert(latex, { selectionMode: 'placeholder' });
    latestChange.current(field.current?.value || '');
  }

  return <div className="formula-editor">
    <div className="formula-tools" role="toolbar" aria-label="公式结构">
      {structures.map((item) => <button type="button" key={item.label} title={item.label} aria-label={`插入${item.label}`} onClick={() => insert(item.latex)}>{item.symbol}</button>)}
      <button type="button" className={sourceOpen ? 'active' : ''} aria-label="切换 LaTeX 输入" title="LaTeX 输入" onClick={() => setSourceOpen(!sourceOpen)}>TeX</button>
    </div>
    <div ref={mount} className="formula-field" />
    {sourceOpen && <textarea aria-label="LaTeX 源码" value={value} onChange={(event) => onChange(event.target.value)} />}
    {formulaError && <div className="formula-error" role="status">{formulaError}</div>}
    {sourceOpen && value && !formulaError && <MathDisplay latex={value} className="formula-result" />}
  </div>;
}
