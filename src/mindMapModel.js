export const MAP_WIDTH = 1200;
export const MAP_HEIGHT = 700;
export const MAX_MAP_SIZE = 32000;
export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 54;
export const SHAPES = ['rectangle', 'square', 'circle', 'ellipse', 'diamond'];
const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const nodeFontSize = node => clamp(finite(node.fontSize, 15), 12, 28);

// Deterministic wrapping is shared by the editor, exports and Agent.
export function wrapMapText(text, width, fontSize = 15) {
  const lines = [];
  for (const paragraph of String(text || '').split(/\r?\n/)) {
    let line = '', used = 0;
    for (const char of Array.from(paragraph)) {
      const size = /[\u0000-\u00ff]/.test(char) ? fontSize * .58 : fontSize;
      if (line && used + size > width) { lines.push(line); line = ''; used = 0; }
      line += char; used += size;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}
function textWidth(width, shape) { return Math.max(30, width * (shape === 'diamond' ? .56 : shape === 'circle' || shape === 'ellipse' ? .7 : 1) - 24); }
export function nodeSize(node = {}) {
  const shape = node.shape || 'rectangle';
  let width = clamp(finite(node.width, shape === 'circle' || shape === 'square' ? 86 : NODE_WIDTH), shape === 'circle' || shape === 'square' ? 86 : 120, 640);
  const font = nodeFontSize(node);
  const heightFor = w => wrapMapText(node.text, textWidth(w, shape), font).length * font * 1.35 + 24;
  const savedHeight = clamp(finite(node.height, 0), 0, 1200);
  let height = Math.max(shape === 'ellipse' ? 76 : NODE_HEIGHT, savedHeight, heightFor(width) * (shape === 'diamond' ? 1.8 : shape === 'ellipse' ? 1.35 : 1));
  if (shape === 'circle' || shape === 'square') {
    for (let attempt = 0; attempt < 10 && height > width; attempt++) { width = Math.min(1200, Math.max(width + 20, height)); height = Math.max(86, savedHeight, heightFor(width) * (shape === 'circle' ? 1.35 : 1)); }
    height = width = Math.max(width, height);
  }
  return { width: Math.ceil(width), height: Math.ceil(height) };
}
export function nodeTextLines(node) { return wrapMapText(node.text || '未命名', textWidth(nodeSize(node).width, node.shape), nodeFontSize(node)); }
export function mapBounds(nodes = [], padding = 40) {
  if (!nodes.length) return { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT };
  let left = Infinity, top = Infinity, right = 0, bottom = 0;
  for (const node of nodes) { const size = nodeSize(node); left = Math.min(left, finite(node.x, 0)); top = Math.min(top, finite(node.y, 0)); right = Math.max(right, finite(node.x, 0) + size.width); bottom = Math.max(bottom, finite(node.y, 0) + size.height); }
  const x = Math.max(0, left - padding), y = Math.max(0, top - padding);
  return { x, y, width: right - x + padding, height: bottom - y + padding };
}
export function mapDimensions(value = {}) {
  const bounds = mapBounds(value.nodes || [], 40);
  return { width: Math.min(MAX_MAP_SIZE, Math.max(MAP_WIDTH, finite(value.width, MAP_WIDTH), bounds.x + bounds.width)), height: Math.min(MAX_MAP_SIZE, Math.max(MAP_HEIGHT, finite(value.height, MAP_HEIGHT), bounds.y + bounds.height)) };
}
export function normalizeMap(value) {
  const source = Array.isArray(value) ? value : value?.nodes || [];
  const ids = new Set();
  const nodes = source.filter(node => node && typeof node.id === 'string' && !ids.has(node.id) && ids.add(node.id)).map(node => ({ ...node, x: clamp(finite(node.x, 40), 0, MAX_MAP_SIZE - nodeSize(node).width - 40), y: clamp(finite(node.y, 40), 0, MAX_MAP_SIZE - nodeSize(node).height - 40) }));
  const rawEdges = Array.isArray(value?.edges) ? value.edges : nodes.filter(node => node.parent && ids.has(node.parent)).map(node => ({ id: `legacy-${node.id}`, from: node.parent, to: node.id, text: node.edgeText || '', style: node.edgeStyle || 'curve', color: node.edgeColor || '#618e90', width: node.edgeWidth || 2 }));
  const edgeIds = new Set();
  const edges = rawEdges.filter(edge => edge && ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to && !edgeIds.has(edge.id) && edgeIds.add(edge.id));
  return { nodes, edges, ...mapDimensions({ nodes, width: value?.width, height: value?.height }) };
}
export function connectNodes(edges, from, to, id) {
  if (!from || !to || from === to || edges.some(edge => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from))) return edges;
  return [...edges, { id, from, to, text: '', style: 'curve', color: '#618e90', width: 2 }];
}
export function placeNode(x, y, node = {}, canvas = { width: MAP_WIDTH, height: MAP_HEIGHT }) {
  const size = nodeSize(node);
  return { x: clamp(finite(x, 12), 12, Math.max(12, canvas.width - size.width - 12)), y: clamp(finite(y, 12), 12, Math.max(12, canvas.height - size.height - 12)) };
}
export function hasMapOverlaps(nodes, gap = 0) {
  const boxes = nodes.map(node => { const size = nodeSize(node); return { x: node.x, y: node.y, right: node.x + size.width, bottom: node.y + size.height }; }).sort((a, b) => a.x - b.x);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length && boxes[j].x < boxes[i].right + gap; j++) if (boxes[i].y < boxes[j].bottom + gap && boxes[i].bottom + gap > boxes[j].y) return true;
  return false;
}
export function newNode(nodes, id, shape = 'rectangle', canvas = { width: MAP_WIDTH, height: MAP_HEIGHT }) {
  const node = { id, text: '新节点', shape };
  const size = nodeSize(node);
  for (const startY of [210, 20]) for (let y = startY; y < canvas.height - size.height - 12; y += 100) for (let x = 70; x < canvas.width - size.width - 12; x += 205) {
    if (nodes.every(other => { const s = nodeSize(other); return x + size.width + 16 <= other.x || other.x + s.width + 16 <= x || y + size.height + 16 <= other.y || other.y + s.height + 16 <= y; })) return { ...node, x, y };
  }
  const bounds = mapBounds(nodes, 40);
  return { ...node, x: 40, y: Math.min(MAX_MAP_SIZE - size.height - 40, bounds.y + bounds.height) };
}
// A spanning forest handles free connections, shared descendants and cycles.
function forest(map, preferredRoot) {
  const outgoing = new Map(map.nodes.map(node => [node.id, []]));
  const incoming = new Map(map.nodes.map(node => [node.id, 0]));
  for (const edge of map.edges) { outgoing.get(edge.from).push(edge.to); incoming.set(edge.to, incoming.get(edge.to) + 1); }
  const candidates = [...map.nodes].sort((a, b) => a.id === preferredRoot ? -1 : b.id === preferredRoot ? 1 : (incoming.get(a.id) === 0 ? -1 : 0) - (incoming.get(b.id) === 0 ? -1 : 0) || outgoing.get(b.id).length - outgoing.get(a.id).length);
  const visited = new Set(), roots = [], children = new Map(), depth = new Map();
  for (const node of candidates) {
    if (visited.has(node.id)) continue;
    roots.push(node.id); visited.add(node.id); depth.set(node.id, 0);
    const queue = [node.id];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]; children.set(id, []);
      for (const next of outgoing.get(id)) if (!visited.has(next)) { visited.add(next); children.get(id).push(next); depth.set(next, depth.get(id) + 1); queue.push(next); }
    }
  }
  return { roots, children, depth };
}
export function autoLayout(value, direction = 'balanced', preferredRoot) {
  const map = normalizeMap(value);
  if (!['balanced', 'right', 'down', 'grid'].includes(direction)) throw new Error('不支持的导图布局');
  if (!map.nodes.length) return map;
  const lookup = new Map(map.nodes.map(node => [node.id, node]));
  const sizes = new Map(map.nodes.map(node => [node.id, nodeSize(node)]));
  const positions = new Map();
  if (direction === 'grid') {
    const columns = Math.max(1, Math.ceil(Math.sqrt(map.nodes.length)));
    const widths = [], heights = [];
    map.nodes.forEach((node, i) => { const z = sizes.get(node.id); widths[i % columns] = Math.max(widths[i % columns] || 0, z.width); heights[Math.floor(i / columns)] = Math.max(heights[Math.floor(i / columns)] || 0, z.height); });
    let y = 48;
    heights.forEach((height, row) => { let x = 48; widths.forEach((width, column) => { const node = map.nodes[row * columns + column]; if (node) positions.set(node.id, { x, y }); x += width + 48; }); y += height + 28; });
  } else {
    const { roots, children } = forest(map, preferredRoot);
    const vertical = direction === 'down', spans = new Map(), gap = 20, levelGap = 56;
    const primary = id => sizes.get(id)[vertical ? 'height' : 'width'];
    const secondary = id => sizes.get(id)[vertical ? 'width' : 'height'];
    function measure(id) { const kids = children.get(id); const span = Math.max(secondary(id), kids.reduce((sum, kid) => sum + measure(kid), 0) + Math.max(0, kids.length - 1) * gap); spans.set(id, span); return span; }
    // Each edge uses its own parent's size, avoiding global gaps from a long title.
    function assign(id, start, advance, side = 1) {
      const middle = start + (spans.get(id) - secondary(id)) / 2;
      positions.set(id, vertical ? { x: middle, y: advance } : { x: side > 0 ? advance : advance - primary(id), y: middle });
      const kids = children.get(id), total = kids.reduce((sum, kid) => sum + spans.get(kid), 0) + Math.max(0, kids.length - 1) * gap;
      let childStart = start + (spans.get(id) - total) / 2;
      for (const child of kids) { assign(child, childStart, advance + side * (primary(id) + levelGap), side); childStart += spans.get(child) + gap; }
    }
    let start = 48;
    for (const root of roots) {
      measure(root);
      if (direction !== 'balanced' || children.get(root).length < 2) { assign(root, start, 48); start += spans.get(root) + 64; continue; }
      const sides = [[], []], heights = [0, 0];
      for (const child of children.get(root)) { const side = heights[0] <= heights[1] ? 0 : 1; if (sides[side].length) heights[side] += gap; sides[side].push(child); heights[side] += spans.get(child); }
      const span = Math.max(secondary(root), ...heights), center = start + span / 2;
      positions.set(root, { x: 0, y: center - secondary(root) / 2 });
      sides.forEach((kids, side) => { let top = center - heights[side] / 2; for (const child of kids) { assign(child, top, side === 0 ? primary(root) + levelGap : -levelGap, side === 0 ? 1 : -1); top += spans.get(child) + gap; } });
      start += span + 64;
    }
  }
  const minX = Math.min(...[...positions.values()].map(point => point.x)), minY = Math.min(...[...positions.values()].map(point => point.y));
  const nodes = map.nodes.map(node => { const point = positions.get(node.id); return { ...node, x: point.x - minX + 48, y: point.y - minY + 48 }; });
  const bounds = mapBounds(nodes);
  if (bounds.x + bounds.width > MAX_MAP_SIZE || bounds.y + bounds.height > MAX_MAP_SIZE) throw new Error('布局超过画布上限，请改用网格布局或分成多张导图');
  return { ...map, nodes, ...mapDimensions({ nodes, width: map.width, height: map.height }) };
}

export function styleMindMap(value, resetStyle = false) {
  const map = normalizeMap(value), { roots, children, depth } = forest(map);
  const palette = [ ['#e8f2ff', '#5c80b8'], ['#e3f3ec', '#428c76'], ['#fff1dd', '#ad813f'], ['#f1eaff', '#8a6bb3'], ['#fdebf0', '#b66e86'] ];
  const branch = new Map(); let index = 0;
  function mark(id, shade) { branch.set(id, shade); for (const child of children.get(id)) mark(child, shade); }
  for (const root of roots) { branch.set(root, 0); for (const child of children.get(root)) mark(child, index++ % palette.length); }
  return { ...map, nodes: map.nodes.map(node => {
    if (resetStyle) { node = { ...node }; for (const key of ['width', 'height', 'fontSize', 'bold', 'fill', 'textColor', 'color']) delete node[key]; }
    const level = depth.get(node.id), [fill, color] = palette[branch.get(node.id) || 0];
    return { ...node, width: node.width ?? (level === 0 ? 240 : level === 1 ? 190 : 176), fontSize: node.fontSize ?? (level === 0 ? 18 : level === 1 ? 16 : 15), bold: node.bold ?? level < 2, fill: node.fill ?? (level === 0 ? '#176d72' : level === 1 ? fill : '#ffffff'), textColor: node.textColor ?? (level === 0 ? '#ffffff' : '#254c50'), color: node.color ?? (level === 0 ? '#176d72' : color) };
  }), edges: map.edges.map(edge => ({ ...edge, color: !resetStyle && edge.color && edge.color !== '#618e90' ? edge.color : palette[branch.get(edge.to) || 0][1], width: edge.width || 2 })) };
}

export function prepareGeneratedMindMap(value) { return autoLayout(styleMindMap(value), 'balanced'); }
export function visibleMap(value) {
  const map = normalizeMap(value), visible = new Set(), grouped = new Set();
  const outgoing = new Map(map.nodes.map(node => [node.id, []]));
  const incoming = new Map(map.nodes.map(node => [node.id, []]));
  const neighbours = new Map(map.nodes.map(node => [node.id, []]));
  const lookup = new Map(map.nodes.map(node => [node.id, node]));
  for (const edge of map.edges) { outgoing.get(edge.from).push(edge.to); incoming.get(edge.to).push(edge.from); neighbours.get(edge.from).push(edge.to); neighbours.get(edge.to).push(edge.from); }
  for (const node of map.nodes) {
    if (grouped.has(node.id)) continue;
    const component = [node.id]; grouped.add(node.id);
    for (let i = 0; i < component.length; i++) for (const neighbour of neighbours.get(component[i])) if (!grouped.has(neighbour)) { grouped.add(neighbour); component.push(neighbour); }
    const sources = component.filter(id => incoming.get(id).length === 0);
    const queue = sources.length ? sources : [component[0]];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]; if (visible.has(id)) continue;
      visible.add(id); if (!lookup.get(id).collapsed) queue.push(...outgoing.get(id));
    }
  }
  return { ...map, nodes: map.nodes.filter(node => visible.has(node.id)), edges: map.edges.filter(edge => visible.has(edge.from) && visible.has(edge.to)), hiddenCount: map.nodes.length - visible.size };
}
export function fitMapView(nodes, width, height) {
  const bounds = mapBounds(nodes, 60);
  const zoom = clamp(Math.min(Math.max(1, width - 24) / bounds.width, Math.max(1, height - 24) / bounds.height, 1.5), .02, 2);
  return { zoom, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}
export function edgePath(parent, node) {
  const a = nodeSize(parent), b = nodeSize(node);
  const dx = node.x + b.width / 2 - parent.x - a.width / 2, dy = node.y + b.height / 2 - parent.y - a.height / 2;
  const gapX = Math.max(node.x - parent.x - a.width, parent.x - node.x - b.width);
  const gapY = Math.max(node.y - parent.y - a.height, parent.y - node.y - b.height);
  const vertical = gapY > 0 && (gapX <= 0 || gapY > gapX * 4), forward = vertical ? dy >= 0 : dx >= 0;
  const x1 = parent.x + (vertical ? a.width / 2 : forward ? a.width : 0), y1 = parent.y + (vertical ? forward ? a.height : 0 : a.height / 2);
  const x2 = node.x + (vertical ? b.width / 2 : forward ? 0 : b.width), y2 = node.y + (vertical ? forward ? 0 : b.height : b.height / 2);
  const style = node.style || node.edgeStyle;
  if (style === 'straight') return `M ${x1} ${y1} L ${x2} ${y2}`;
  if (style === 'elbow') { const mid = vertical ? (y1 + y2) / 2 : (x1 + x2) / 2; return vertical ? `M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}` : `M ${x1} ${y1} L ${mid} ${y1} L ${mid} ${y2} L ${x2} ${y2}`; }
  const offset = Math.max(35, Math.abs(vertical ? y2 - y1 : x2 - x1) * .45) * (forward ? 1 : -1);
  return vertical ? `M ${x1} ${y1} C ${x1} ${y1 + offset}, ${x2} ${y2 - offset}, ${x2} ${y2}` : `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}`;
}
export function edgeLabelPosition(from, to) { const a = nodeSize(from), b = nodeSize(to); return { x: (from.x + a.width / 2 + to.x + b.width / 2) / 2, y: (from.y + a.height / 2 + to.y + b.height / 2) / 2 - 10 }; }

export function mapExportBounds(map) {
  const bounds = mapBounds(map.nodes, 70), lookup = new Map(map.nodes.map(node => [node.id, node]));
  let left = bounds.x, top = bounds.y, right = left + bounds.width, bottom = top + bounds.height;
  for (const edge of map.edges || []) {
    const from = lookup.get(edge.from), to = lookup.get(edge.to);
    if (!edge.text || !from || !to) continue;
    const label = edgeLabelPosition(from, to), halfHeight = (wrapMapText(edge.text, 200, 13).length * 17 + 10) / 2;
    left = Math.min(left, label.x - 120); right = Math.max(right, label.x + 120);
    top = Math.min(top, label.y - halfHeight - 12); bottom = Math.max(bottom, label.y + halfHeight + 12);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function parseMindMapFile(text) {
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('导图文件不能超过2MB');
  let value; try { value = JSON.parse(text); } catch { throw new Error('导图JSON格式无效'); }
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || value.nodes.length > 500 || value.edges.length > 1500) throw new Error('导图最多500个节点、1500条连接线');
  for (const [key, min] of [['width', MAP_WIDTH], ['height', MAP_HEIGHT]]) if (value[key] !== undefined && (!Number.isFinite(value[key]) || value[key] < min || value[key] > MAX_MAP_SIZE)) throw new Error('画布尺寸无效');
  const ids = new Set(), edgeIds = new Set();
  for (const node of value.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id) || typeof node.text !== 'string' || node.text.length > 1000 || !Number.isFinite(node.x) || !Number.isFinite(node.y) || node.x < 0 || node.y < 0 || node.x + nodeSize(node).width > MAX_MAP_SIZE - 12 || node.y + nodeSize(node).height > MAX_MAP_SIZE - 12 || node.shape && !SHAPES.includes(node.shape)) throw new Error('节点编号、文字、位置或形状无效');
    for (const [field, min, max] of [['width', 86, 640], ['height', 54, 1200], ['fontSize', 12, 28]]) if (node[field] !== undefined && (!Number.isFinite(node[field]) || node[field] < min || node[field] > max)) throw new Error('节点尺寸或字号无效');
    for (const key of ['fill', 'color', 'textColor']) if (node[key] !== undefined && !/^#[0-9a-f]{6}$/i.test(node[key])) throw new Error('节点颜色无效');
    for (const key of ['bold', 'collapsed']) if (node[key] !== undefined && typeof node[key] !== 'boolean') throw new Error('节点折叠或样式标记无效');
    ids.add(node.id);
  }
  for (const edge of value.edges) {
    if (!edge || typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || edge.text !== undefined && (typeof edge.text !== 'string' || edge.text.length > 300)) throw new Error('连接线编号、节点或文字无效');
    edgeIds.add(edge.id);
    if (edge.style !== undefined && !['curve', 'straight', 'elbow'].includes(edge.style) || edge.width !== undefined && (!Number.isFinite(edge.width) || edge.width < 1 || edge.width > 8) || edge.color !== undefined && !/^#[0-9a-f]{6}$/i.test(edge.color)) throw new Error('连接线样式无效');
    for (const key of ['arrow', 'dashed']) if (edge[key] !== undefined && typeof edge[key] !== 'boolean') throw new Error('连接线箭头或虚线标记无效');
  }
  return normalizeMap(value);
}
