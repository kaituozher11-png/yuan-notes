export function runInBounds(rect, bounds) {
  const middle = (rect.left + rect.right) / 2;
  return rect.width > 0 && middle > bounds.left && middle < bounds.right;
}

export function nearestTextRun(runs, x, y, bounds) {
  return runs.filter(({ rect }) => runInBounds(rect, bounds)).reduce((best, run) => {
    const { rect } = run;
    const dx = Math.max(rect.left - x, x - rect.right, 0);
    const dy = Math.max(rect.top - y, y - rect.bottom, 0);
    const distance = Math.hypot(dx, dy * 1.5);
    return !best || distance < best.distance ? { run, dx, dy, distance } : best;
  }, null);
}

export function selectionColumnBounds(page, text, runs) {
  const middle = page.left + page.width / 2;
  const full = { left: page.left, right: page.right };
  if (text.width > page.width * .55) return full;

  const minWidth = page.width * .07;
  const gutter = page.width * .01;
  const anchorY = (text.top + text.bottom) / 2;
  const band = Math.max(page.height * .15, text.height * 5);
  const body = runs.filter(({ rect }) => rect.width >= minWidth && rect.width <= page.width * .52 &&
    rect.height > 0 && rect.height < page.height * .08 &&
    Math.abs((rect.top + rect.bottom) / 2 - anchorY) <= band);
  const left = body.filter(({ rect }) => rect.right < middle - gutter);
  const right = body.filter(({ rect }) => rect.left > middle + gutter);
  const paired = left.filter(({ rect }) => right.some(({ rect: other }) =>
    Math.abs((rect.top + rect.bottom) - (other.top + other.bottom)) / 2 <= Math.max(rect.height, other.height) * 1.5));
  if (!paired.length) return full;

  return (text.left + text.right) / 2 < middle
    ? { left: page.left, right: middle - 1 }
    : { left: middle + 1, right: page.right };
}

export function selectVisibleText(runs, anchor, focus, bounds) {
  const candidates = runs.filter(({ rect }) => runInBounds(rect, bounds));
  const rows = [];
  for (const run of [...candidates].sort((a, b) => (a.rect.top + a.rect.bottom) - (b.rect.top + b.rect.bottom))) {
    const center = (run.rect.top + run.rect.bottom) / 2;
    const row = rows.find((item) => Math.abs(item.center - center) <= Math.max(item.height, run.rect.height) * .45);
    if (row) row.runs.push(run);
    else rows.push({ center, height: run.rect.height, runs: [run] });
  }
  const ordered = rows.sort((a, b) => a.center - b.center).flatMap((row, line) =>
    row.runs.sort((a, b) => a.rect.left - b.rect.left).map((run) => ({ ...run, line })));
  const first = ordered.findIndex((run) => run.id === anchor.id);
  const last = ordered.findIndex((run) => run.id === focus.id);
  if (first < 0 || last < 0) return { text: '', segments: [] };
  const forward = first <= last;
  const from = forward ? first : last;
  const to = forward ? last : first;
  const segments = ordered.slice(from, to + 1).map((run, index) => ({
    ...run,
    start: index === 0 && index === to - from ? Math.min(anchor.offset, focus.offset)
      : index === 0 ? (forward ? anchor.offset : focus.offset) : 0,
    end: index === 0 && index === to - from ? Math.max(anchor.offset, focus.offset)
      : index === to - from ? (forward ? focus.offset : anchor.offset) : run.text.length,
  })).filter((run) => run.end > run.start);
  let text = '';
  let previous = null;
  for (const segment of segments) {
    if (previous) {
      if (segment.line !== previous.line) text += '\n';
      else if (segment.rect.left - previous.rect.right > Math.max(2, segment.rect.height * .2) && !/\s$/.test(text)) text += ' ';
    }
    text += segment.text.slice(segment.start, segment.end);
    previous = segment;
  }
  return { text: text.trim(), segments };
}
