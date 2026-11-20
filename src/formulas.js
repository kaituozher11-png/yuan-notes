const equationStart = /^[A-Za-z\\{(\[][^=]*=/;
const cjk = /[\u3400-\u9fff]/;

export function legacyEquationToLatex(value) {
  const expression = value.trim();
  if (expression.includes('\\')) return expression;
  return expression
    .replace(/\b([A-Z])([1-9])\b/g, '$1_$2')
    .replace(/(?<![A-Za-z\\])(ReLU|BN|fconv|Pool|Cat|TConv|Sigmoid|Softmax|Up|Split|mean|std|max)(?=\s*[_({])/g, '\\operatorname{$1}')
    .replace(/×/g, '\\times ')
    .replace(/⊕/g, '\\oplus ')
    .replace(/⊗/g, '\\otimes ')
    .replace(/Σ/g, '\\sum ')
    .replace(/∪/g, '\\cup ')
    .replace(/·/g, '\\cdot ')
    .replace(/≤/g, '\\le ')
    .replace(/≥/g, '\\ge ')
    .replace(/−/g, '-');
}

function parsePart(part) {
  const explicit = part.match(/^(.*?)\$\$([^$]+)\$\$(.*)$/) || part.match(/^(.*?)\$([^$]+)\$(.*)$/);
  if (explicit) return [
    ...(explicit[1].trim() ? [{ type: 'text', value: explicit[1].trim() }] : []),
    { type: 'math', value: explicit[2].trim() },
    ...(explicit[3].trim() ? [{ type: 'text', value: explicit[3].trim() }] : []),
  ];

  let prefix = '';
  const colon = part.indexOf('：');
  if (colon > 0 && cjk.test(part.slice(0, colon)) && part.slice(colon + 1).includes('=')) {
    prefix = part.slice(0, colon + 1).trim();
    part = part.slice(colon + 1).trim();
  }
  const detail = part.search(/[，,](?=\s*[\u3400-\u9fff])/);
  const expression = detail < 0 ? part : part.slice(0, detail).trim();
  const explanation = detail < 0 ? '' : part.slice(detail + 1).trim();
  if (!equationStart.test(expression) || cjk.test(expression)) return [{ type: 'text', value: [prefix, part].filter(Boolean).join(' ') }];
  return [
    ...(prefix ? [{ type: 'text', value: prefix }] : []),
    { type: 'math', value: legacyEquationToLatex(expression) },
    ...(explanation ? [{ type: 'text', value: explanation }] : []),
  ];
}

export function parseFormulaEntry(value) {
  return String(value || '').split(/[；;]/).map((part) => part.trim()).filter(Boolean).flatMap(parsePart);
}
