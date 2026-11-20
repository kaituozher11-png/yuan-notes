const cjk = /[\u3400-\u9fff]/;
const heading = /^(?:\d+(?:\.\d+){1,3}\s*\S|摘要|关键词|参考文献|附录)/;

export function findSourceQuote(source, quote) {
  const needle = String(quote || '').replace(/\s+/g, '').toLowerCase();
  if (!needle) return null;
  let compact = '';
  const positions = [];
  for (let index = 0; index < source.length; index++) {
    if (/\s/.test(source[index])) continue;
    compact += source[index].toLowerCase();
    positions.push(index);
  }
  const offset = compact.indexOf(needle);
  return offset < 0 ? null : { start: positions[offset], end: positions[offset + needle.length - 1] + 1 };
}

export function findSourceBlockRect(sourcePage, quote, textStart) {
  if (!quote) return null;
  const source = sourcePage?.text || '';
  const exact = Number.isInteger(textStart) && source.slice(textStart, textStart + quote.length) === quote
    ? { start: textStart } : findSourceQuote(source, quote);
  return exact && sourcePage?.blocks?.find((block) =>
    block.start <= exact.start && block.end > exact.start)?.rect || null;
}

function clean(value) {
  return value.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1').trim();
}

function lineText(items) {
  let result = '';
  let previous = null;
  for (const item of items.sort((a, b) => a.x - b.x)) {
    const part = clean(item.str);
    if (!part) continue;
    const gap = previous ? item.x - previous.right : 0;
    if (result && gap > Math.max(2, item.height * .25) && !/\s$/.test(result) &&
        (!cjk.test(result.at(-1)) || !cjk.test(part[0]))) result += ' ';
    result += part;
    previous = item;
  }
  return result;
}

function isFormula(text) {
  const chinese = [...text].filter((char) => cjk.test(char)).length;
  return text.length < 150 && chinese <= 2 &&
    (/[=∑∫√≤≥∈⊕⊗]/.test(text) || /[A-Za-z]\s*\^\s*\d/.test(text));
}

function rectOf(lines, width, height, padding = 0) {
  const x = Math.max(0, Math.min(...lines.map((line) => line.x)) - 5);
  const y = Math.max(0, Math.min(...lines.map((line) => line.top)) - 6 - padding);
  const right = Math.min(width, Math.max(...lines.map((line) => line.right)) + 8);
  const bottom = Math.min(height, Math.max(...lines.map((line) => line.bottom)) + 6 + padding);
  return { x: x / width, y: y / height, width: (right - x) / width, height: (bottom - y) / height };
}

function figureRectangles(items, width, height) {
  return items.filter((item) => /^Fig\.\s*\d+/.test(item.str?.trim() || '')).map((caption) => {
    const x = caption.transform[4];
    const column = x < width * .3 ? 'left' : x > width * .5 ? 'right' : 'wide';
    const left = column === 'right' ? width * .51 : column === 'left' ? width * .07 : width * .06;
    const right = column === 'right' ? width * .93 : column === 'left' ? width * .49 : width * .94;
    const rows = new Map();
    for (const item of items) {
      const itemX = item.transform?.[4] || 0;
      if (item.transform?.[5] <= caption.transform[5] + 25 ||
          (column === 'left' && itemX >= width * .5) ||
          (column === 'right' && itemX < width * .5)) continue;
      const key = Math.round(item.transform[5] / 3);
      const row = rows.get(key) || { y: item.transform[5], height: 0, text: '' };
      row.height = Math.max(row.height, item.height || 0);
      row.text += item.str || '';
      rows.set(key, row);
    }
    const bodyAbove = [...rows.values()].filter((row) =>
      [...row.text].filter((char) => cjk.test(char)).length >= 8 && /[。！？，]/.test(row.text))
      .sort((a, b) => a.y - b.y)[0];
    const upper = bodyAbove ? bodyAbove.y - bodyAbove.height - 8 : height - 75;
    const lower = caption.transform[5] + 22;
    if (upper <= lower + 35) return null;
    const captionRuns = items.filter((item) => Math.abs(item.transform?.[5] - caption.transform[5] - 12) < 3 &&
      item.transform[4] >= left && item.transform[4] <= right)
      .map((item) => ({ str: item.str, x: item.transform[4], right: item.transform[4] + item.width, height: item.height }));
    const captionText = lineText(captionRuns);
    return { x: left / width, y: (height - upper) / height, width: (right - left) / width,
      height: (upper - lower) / height, label: captionText.startsWith('图') ? captionText : `图 ${caption.str.match(/\d+/)[0]}`,
      captionY: caption.transform[5] };
  }).filter(Boolean);
}

function contains(rect, item, width, height) {
  const x = item.transform[4] / width;
  const y = (height - item.transform[5]) / height;
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function buildSourcePage(items, width, height, imageRects = []) {
  const figures = figureRectangles(items, width, height);
  const allRuns = items.filter((item) => item.str?.trim() && item.height > 0);
  const leftLong = allRuns.filter((item) => item.str.length >= 8 && item.transform[4] < width * .45 && item.transform[4] + item.width < width * .52).length;
  const rightLong = allRuns.filter((item) => item.str.length >= 8 && item.transform[4] > width * .5).length;
  const columns = leftLong >= 8 && rightLong >= 8 ? 2 : 1;
  const runs = allRuns.filter((item) => !figures.some((rect) => contains(rect, item, width, height) ||
    (item.transform[4] / width >= rect.x && item.transform[4] / width <= rect.x + rect.width &&
      Math.abs(item.transform[5] - rect.captionY) < 18))).map((item) => ({
    str: item.str, x: item.transform[4], y: item.transform[5],
    right: item.transform[4] + item.width, height: item.height,
  }));
  const lines = [];
  for (let column = 0; column < columns; column++) {
    const ordered = runs.filter((item) => columns === 1 || (item.x < width * .49 ? 0 : 1) === column)
      .sort((a, b) => b.y - a.y || a.x - b.x);
    let line = null;
    for (const item of ordered) {
      if (!line || Math.abs(line.y - item.y) > Math.max(2.5, item.height * .32)) {
        line = { column, y: item.y, items: [] };
        lines.push(line);
      }
      line.items.push(item);
    }
  }
  const prepared = lines.map((line) => ({
    column: line.column, y: line.y, text: lineText(line.items),
    x: Math.min(...line.items.map((item) => item.x)),
    right: Math.max(...line.items.map((item) => item.right)),
    top: height - Math.max(...line.items.map((item) => item.y + item.height)),
    bottom: height - Math.min(...line.items.map((item) => item.y - item.height * .3)),
    height: Math.max(...line.items.map((item) => item.height)),
  })).filter((line) => line.text);

  const mathLines = new Set(prepared.flatMap((line, index) => isFormula(line.text) ? [index] : []));
  for (let index = 0; index < prepared.length; index++) {
    if (mathLines.has(index)) continue;
    const line = prepared[index];
    const nearbyFormula = [index - 1, index + 1].some((neighbor) => {
      const other = prepared[neighbor];
      return other && mathLines.has(neighbor) && other.column === line.column &&
        Math.abs(other.y - line.y) <= 23 && Math.abs(other.x - line.x) < 150;
    });
    if (nearbyFormula && line.text.length <= 24 && !cjk.test(line.text)) mathLines.add(index);
  }

  const blocks = [];
  let current = null;
  let previous = null;
  for (const [index, line] of prepared.entries()) {
    const formula = mathLines.has(index);
    const title = heading.test(line.text) && line.text.length <= 45;
    const gap = previous && line.column === previous.column ? previous.y - line.y : Infinity;
    const newParagraph = !current || current.type === 'heading' || line.column !== previous.column || formula !== (current.type === 'formula') ||
      gap > Math.max(line.height, previous?.height || 0) * 1.75 ||
      title ||
      (line.x - previous.x > line.height * 1.4 && /[。！？：]$/.test(previous.text));
    if (newParagraph) {
      current = { type: formula ? 'formula' : title ? 'heading' : 'paragraph', lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
    previous = line;
  }
  const textBlocks = blocks.map((block) => ({
    type: block.type,
    text: block.lines.map((line) => line.text).join(block.type === 'formula' ? ' ' : ''),
    rect: rectOf(block.lines, width, height, block.type === 'formula' ? -7 : 0),
  }));
  const pictures = [...figures, ...imageRects.filter((rect) => !figures.some((figure) => {
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    return centerX >= figure.x && centerX <= figure.x + figure.width && centerY >= figure.y && centerY <= figure.y + figure.height;
  }))].map((rect) => ({ type: 'image', rect, text: '', label: rect.label || '原文插图' }));
  let text = '';
  for (const block of textBlocks) {
    if (text) text += '\n\n';
    block.start = text.length;
    text += block.text;
    block.end = text.length;
  }
  return { text, blocks: [...textBlocks, ...pictures], columns };
}

function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

export function imageRectangles(operatorList, ops, width, height) {
  const stack = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  const rectangles = [];
  for (let index = 0; index < operatorList.fnArray.length; index++) {
    const op = operatorList.fnArray[index];
    if (op === ops.save) stack.push(matrix);
    else if (op === ops.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === ops.transform) matrix = multiply(matrix, operatorList.argsArray[index]);
    else if (op === ops.paintImageXObject || op === ops.paintInlineImageXObject || op === ops.paintJpegXObject) {
      const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
      const left = Math.max(0, Math.min(...points.map((point) => point[0])));
      const right = Math.min(width, Math.max(...points.map((point) => point[0])));
      const top = Math.max(0, height - Math.max(...points.map((point) => point[1])));
      const bottom = Math.min(height, height - Math.min(...points.map((point) => point[1])));
      if (right - left >= 55 && bottom - top >= 35 && (right - left) * (bottom - top) >= 3000)
        rectangles.push({ x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height });
    }
  }
  return rectangles.filter((rect, index) => !rectangles.some((other, i) => i < index && Math.abs(other.x - rect.x) < .01 && Math.abs(other.y - rect.y) < .01));
}
