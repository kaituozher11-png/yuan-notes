export const MAP_WIDTH = 1200;
export const MAP_HEIGHT = 700;
export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 54;
export const SHAPES = ['rectangle', 'square', 'circle', 'ellipse', 'diamond'];

export function nodeSize(node) {
  if (node.shape === 'square' || node.shape === 'circle') return { width: 86, height: 86 };
  if (node.shape === 'ellipse') return { width: 160, height: 76 };
  return { width: NODE_WIDTH, height: NODE_HEIGHT };
}

export function normalizeMap(value) {
  const nodes = Array.isArray(value) ? value : value?.nodes || [];
  const edges = Array.isArray(value?.edges) ? value.edges : nodes.filter((node) => node.parent && nodes.some((item) => item.id === node.parent)).map((node) => ({
    id: `legacy-${node.id}`, from: node.parent, to: node.id, text: node.edgeText || '',
    style: node.edgeStyle || 'curve', color: node.edgeColor || '#618e90', width: node.edgeWidth || 2,
  }));
  return { nodes, edges };
}

export function connectNodes(edges, from, to, id) {
  if (!from || !to || from === to || edges.some((edge) =>
    (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from))) return edges;
  return [...edges, { id, from, to, text: '', style: 'curve', color: '#618e90', width: 2 }];
}

export function placeNode(x, y, node = {}) {
  const { width, height } = nodeSize(node);
  return { x: Math.max(12, Math.min(MAP_WIDTH - width - 12, x)), y: Math.max(12, Math.min(MAP_HEIGHT - height - 12, y)) };
}

export function newNode(nodes, id, shape = 'rectangle') {
  const { width, height } = nodeSize({ shape });
  for (const startY of [210, 20]) {
    for (let y = startY; y <= MAP_HEIGHT - height - 12; y += 100) {
      for (let x = 70; x <= MAP_WIDTH - width - 12; x += 205) {
        const clear = nodes.every((node) => {
          const size = nodeSize(node);
          return x + width + 16 <= node.x || node.x + size.width + 16 <= x ||
            y + height + 16 <= node.y || node.y + size.height + 16 <= y;
        });
        if (clear) return { id, text: '新节点', shape, x, y };
      }
    }
  }
  return { id, text: '新节点', shape, ...placeNode(70 + nodes.length * 37, 210 + nodes.length * 29, { shape }) };
}

export function edgePath(parent, node) {
  const from = nodeSize(parent);
  const to = nodeSize(node);
  const leftToRight = parent.x + from.width / 2 < node.x + to.width / 2;
  const startX = leftToRight ? parent.x + from.width : parent.x;
  const startY = parent.y + from.height / 2;
  const endX = leftToRight ? node.x : node.x + to.width;
  const endY = node.y + to.height / 2;
  const style = node.style || node.edgeStyle;
  if (style === 'straight') return `M ${startX} ${startY} L ${endX} ${endY}`;
  if (style === 'elbow') {
    const middle = (startX + endX) / 2;
    return `M ${startX} ${startY} L ${middle} ${startY} L ${middle} ${endY} L ${endX} ${endY}`;
  }
  const offset = Math.max(35, Math.abs(endX - startX) * .45) * (leftToRight ? 1 : -1);
  return `M ${startX} ${startY} C ${startX + offset} ${startY}, ${endX - offset} ${endY}, ${endX} ${endY}`;
}

export function edgeLabelPosition(from, to) {
  const a = nodeSize(from); const b = nodeSize(to);
  return { x: (from.x + a.width / 2 + to.x + b.width / 2) / 2, y: (from.y + a.height / 2 + to.y + b.height / 2) / 2 - 10 };
}
