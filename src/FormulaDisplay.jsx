import katex from 'katex';
import { parseFormulaEntry } from './formulas';

export function MathDisplay({ latex, className = '', output = 'htmlAndMathml' }) {
  if (!latex?.trim()) return null;
  try {
    const html = katex.renderToString(latex, { displayMode: true, throwOnError: true, trust: false, output });
    return <div className={`math-display ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <div className={`math-display math-invalid ${className}`}>{latex}</div>;
  }
}

export function FormulaEntry({ value, output }) {
  return <div className="formula-entry">{parseFormulaEntry(value).map((part, index) => part.type === 'math'
    ? <MathDisplay latex={part.value} output={output} key={index} />
    : <p key={index}>{part.value}</p>)}</div>;
}
