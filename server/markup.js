const inPage = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export function validateMarkup(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.strokes) || !Array.isArray(input.stickies)) throw new Error('原文标记格式无效');
  if (input.strokes.length > 1000 || input.stickies.length > 100) throw new Error('本页标记数量过多');
  const strokes = input.strokes.map((stroke) => {
    if (!['pen', 'highlighter', 'eraser'].includes(stroke.tool)
      || !/^#[0-9a-fA-F]{6}$/.test(stroke.color)
      || !Number.isFinite(stroke.size) || stroke.size < 1 || stroke.size > 40
      || !Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > 2500
      || !stroke.points.every((point) => Array.isArray(point) && point.length === 2 && point.every(inPage))) throw new Error('笔迹数据无效');
    return { tool: stroke.tool, color: stroke.color, size: stroke.size, points: stroke.points };
  });
  const ids = new Set();
  const stickies = input.stickies.map((sticky) => {
    if (typeof sticky.id !== 'string' || sticky.id.length < 1 || sticky.id.length > 80 || ids.has(sticky.id)
      || !inPage(sticky.x) || !inPage(sticky.y)
      || typeof sticky.text !== 'string' || sticky.text.length > 2000
      || typeof sticky.collapsed !== 'boolean') throw new Error('便利贴数据无效');
    ids.add(sticky.id);
    return { id: sticky.id, x: sticky.x, y: sticky.y, text: sticky.text, collapsed: sticky.collapsed };
  });
  return { strokes, stickies };
}
