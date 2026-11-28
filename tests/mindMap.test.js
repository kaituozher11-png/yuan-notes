import test from 'node:test';
import assert from 'node:assert/strict';
import { connectNodes, edgePath, newNode, nodeSize, normalizeMap, placeNode, MAP_WIDTH, MAP_HEIGHT, NODE_WIDTH, NODE_HEIGHT } from '../src/mindMapModel.js';
import { autoLayout, fitMapView, hasMapOverlaps, mapBounds, mapExportBounds, MAX_MAP_SIZE, nodeTextLines, parseMindMapFile, visibleMap } from '../src/mindMapModel.js';

test('places new shapes independently without overlapping other nodes', () => {
  const nodes = [{ id: 'root', text: '中心', x: 70, y: 110, shape: 'rectangle' }];
  for (let index = 0; index < 15; index += 1) {
    const shape = index % 2 ? 'circle' : 'rectangle';
    const node = newNode(nodes, `node-${index}`, shape);
    assert.equal(node.shape, shape);
    assert.equal(node.parent, undefined);
    const size = nodeSize(node);
    for (const existing of nodes) {
      const previous = nodeSize(existing);
      assert.ok(node.x + size.width <= existing.x || existing.x + previous.width <= node.x ||
        node.y + size.height <= existing.y || existing.y + previous.height <= node.y);
    }
    nodes.push(node);
  }
});

test('keeps legacy links and supports arbitrary labeled connections and shapes', () => {
  const nodes = [
    { id: 'a', x: 20, y: 20, text: 'A', shape: 'circle' },
    { id: 'b', x: 300, y: 180, text: 'B', parent: 'a', edgeText: '旧连线' },
    { id: 'c', x: 550, y: 40, text: 'C', shape: 'square' },
  ];
  const legacy = normalizeMap({ nodes });
  assert.equal(legacy.edges[0].text, '旧连线');
  const edges = connectNodes(legacy.edges, 'c', 'a', 'new');
  assert.equal(edges.length, 2);
  assert.strictEqual(connectNodes(edges, 'c', 'a', 'duplicate'), edges);
  assert.strictEqual(connectNodes(edges, 'a', 'c', 'reverse-duplicate'), edges);
  assert.strictEqual(connectNodes(edges, 'a', 'a', 'self'), edges);
  assert.deepEqual(nodeSize(nodes[0]), { width: 86, height: 86 });
  assert.deepEqual(placeNode(2000, 2000, nodes[0]), { x: MAP_WIDTH - 98, y: MAP_HEIGHT - 98 });
  assert.match(edgePath(nodes[2], { ...nodes[0], style: 'straight' }), / L /);
});

test('keeps dragged nodes on canvas and draws selected connector styles', () => {
  assert.deepEqual(placeNode(-50, 2000), { x: 12, y: MAP_HEIGHT - NODE_HEIGHT - 12 });
  assert.deepEqual(placeNode(2000, -50), { x: MAP_WIDTH - NODE_WIDTH - 12, y: 12 });
  assert.match(edgePath({ x: 0, y: 0 }, { x: 220, y: 80, edgeStyle: 'elbow' }), / L /);
  assert.match(edgePath({ x: 0, y: 0 }, { x: 220, y: 80, edgeStyle: 'straight' }), / L /);
});

test('long bilingual text remains complete in every shape and expands the node height', () => {
  const text = '宽带FMCW波束斜视与门限13.01dB，中文数字ABC123连续显示。'.repeat(8);
  for (const shape of ['rectangle', 'square', 'circle', 'ellipse', 'diamond']) {
    const node = { shape, text, width: 200, fontSize: 18 };
    const size = nodeSize(node), lines = nodeTextLines(node);
    assert.equal(lines.join(''), text);
    assert.ok(size.height >= lines.length * 18 * 1.35 + 20);
    assert.ok(size.height > 54);
  }
  assert.deepEqual(nodeTextLines({ text: '第一行\n第二行', width: 200 }), ['第一行', '第二行']);
});

test('expanded map dimensions survive normalization and old nodes outside the old canvas are preserved', () => {
  const value = { width: 3200, height: 2400, nodes: [{ id: 'node', x: 2700, y: 1800, text: '边界节点' }], edges: [] };
  const map = normalizeMap(value);
  assert.equal(map.width, 3200); assert.equal(map.height, 2400);
  assert.equal(map.nodes[0].x, 2700);
  const auto = normalizeMap({ ...value, width: 1200, height: 700 });
  assert.ok(auto.width >= 2900); assert.ok(auto.height >= 1894);
  const bounds = mapBounds(auto.nodes); assert.ok(bounds.x + bounds.width <= auto.width);
  assert.equal(normalizeMap({ nodes: [], width: Infinity, height: NaN }).width, 1200);
});

test('all automatic layouts remove crowded overlaps without losing text, styles, IDs or connections', () => {
  const nodes = [{ id: 'root', text: '中心主题', x: 30, y: 90, shape: 'rectangle', fill: '#ff0000' }];
  const edges = [];
  for (let i = 0; i < 80; i++) {
    nodes.push({ id: 'n' + i, x: 100, y: 100 + i, text: `第${i}个节点，完整长文字与123数字一起显示`.repeat(i % 5 + 1), shape: ['rectangle', 'circle', 'diamond'][i % 3], width: 220 });
    edges.push({ id: 'e' + i, from: i % 4 ? 'n' + (i - 1) : 'root', to: 'n' + i, text: '关系说明', style: 'elbow' });
  }
  for (const direction of ['right', 'down', 'grid']) {
    const result = autoLayout({ nodes, edges }, direction);
    assert.equal(result.nodes.length, nodes.length); assert.deepEqual(result.edges, edges);
    assert.equal(hasMapOverlaps(result.nodes, 12), false, direction);
    assert.deepEqual(result.nodes.map(node => [node.id, node.text, node.fill]), nodes.map(node => [node.id, node.text, node.fill]));
    const bounds = mapBounds(result.nodes); assert.ok(bounds.x + bounds.width <= result.width); assert.ok(bounds.y + bounds.height <= result.height);
  }
  assert.equal(nodes[1].x, 100, 'layout must not mutate saved objects');
});

test('layouts terminate for cycles, disconnected nodes, shared branches and an empty map', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, text: id, x: 20, y: 20 }));
  const edges = [{ id: 'ab', from: 'a', to: 'b' }, { id: 'ba', from: 'b', to: 'a' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'dc', from: 'd', to: 'c' }];
  for (const direction of ['right', 'down', 'grid']) { const map = autoLayout({ nodes, edges }, direction); assert.equal(map.nodes.length, 5); assert.equal(hasMapOverlaps(map.nodes), false); }
  assert.equal(autoLayout({ nodes: [], edges: [] }).nodes.length, 0);
});

test('folding keeps shared descendants and handles nested folds and cycles without deleting saved nodes', () => {
  const nodes = ['a', 'b', 'c', 'd'].map(id => ({ id, text: id, x: 20, y: 20, collapsed: id === 'a' || id === 'b' }));
  const edges = [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }];
  const folded = visibleMap({ nodes, edges });
  assert.deepEqual(folded.nodes.map(node => node.id), ['a', 'd']);
  assert.equal(nodes.length, 4);
  const shared = visibleMap({ nodes, edges: [...edges, { id: 'dc', from: 'd', to: 'c' }] });
  assert.ok(shared.nodes.some(node => node.id === 'c'));
  const cycle = visibleMap({ nodes: nodes.slice(0, 2), edges: [edges[0], { id: 'ba', from: 'b', to: 'a' }] });
  assert.deepEqual(cycle.nodes.map(node => node.id), ['a']);
});

test('map import round-trips expanded canvases and rejects invalid IDs, file size and dangling edges', () => {
  const map = { width: 4000, height: 3000, nodes: [{ id: 'root', text: '所有文字保留', x: 2000, y: 1000, shape: 'circle', fill: '#ffaa11', collapsed: true, width: 200 }], edges: [] };
  const restored = parseMindMapFile(JSON.stringify(map));
  assert.equal(restored.width, 4000); assert.equal(restored.nodes[0].fill, '#ffaa11'); assert.equal(restored.nodes[0].collapsed, true);
  for (const value of ['bad JSON', 'x'.repeat(2_000_001), JSON.stringify({ nodes: [map.nodes[0], map.nodes[0]], edges: [] }), JSON.stringify({ ...map, edges: [{ id: 'x', from: 'root', to: 'missing' }] }), JSON.stringify({ ...map, nodes: [{ ...map.nodes[0], x: Infinity }] })]) assert.throws(() => parseMindMapFile(value));
  assert.ok(fitMapView(restored.nodes, 320, 280).zoom > 0);
  const next = newNode([{ id: 'last', x: 20, y: 20, text: '旧内容' }, { id: 'overlap', x: 20, y: 20, text: '旧重叠' }], 'new', 'circle');
  assert.ok(next.y >= 20); assert.ok(next.x <= MAX_MAP_SIZE);
  const boundary = normalizeMap({ nodes: [{ id: 'end', text: '画布极限', x: 32000, y: 32000 }], edges: [] });
  assert.deepEqual(parseMindMapFile(JSON.stringify(boundary)), boundary, 'exported boundary nodes must re-import without rejection or coordinate drift');
});

test('500-node canvas limit can be arranged without collisions and overlong trees fail without partial edits', () => {
  const nodes = Array.from({ length: 500 }, (_, index) => ({ id: String(index), text: '文字123 ' + index, x: 30, y: 40, shape: 'rectangle' }));
  const result = autoLayout({ nodes, edges: [] }, 'grid');
  assert.equal(result.nodes.length, 500); assert.equal(hasMapOverlaps(result.nodes), false); assert.ok(result.width <= MAX_MAP_SIZE && result.height <= MAX_MAP_SIZE);
  const edges = nodes.slice(1).map((node, index) => ({ id: 'e' + index, from: String(index), to: node.id }));
  assert.throws(() => autoLayout({ nodes, edges }, 'right'), /上限/);
  assert.equal(nodes[0].x, 30);
});

test('export bounds include long connector labels and corrupted height cannot consume the canvas', () => {
  const map = { nodes: [{ id: 'a', text: 'A', x: 0, y: 0 }, { id: 'b', text: 'B', x: 180, y: 0 }], edges: [{ id: 'edge', from: 'a', to: 'b', text: '长连接线文字'.repeat(50) }] };
  const bounds = mapExportBounds(map);
  assert.ok(bounds.y < -100); assert.ok(bounds.height > 300);
  assert.ok(nodeSize({ height: 1e10 }).height <= 1200);
});

test('balanced compact layout keeps wide roots local and distributes dense branches on both sides', async () => {
  const { prepareGeneratedMindMap } = await import('../src/mindMapModel.js');
  const nodes = [{ id: 'root', text: '完整论文的研究逻辑与主要结论', x: 20, y: 2000 }], edges = [];
  for (let b = 0; b < 6; b++) { nodes.push({ id: `b${b}`, text: `第${b}个主要知识分支`, x: 8000, y: b * 900 }); edges.push({ id: `r${b}`, from: 'root', to: `b${b}` });
    for (let n = 0; n < 4; n++) { nodes.push({ id: `b${b}-${n}`, text: `关键概念${n}与条件123`, x: 16000, y: b * 900 + n * 150 }); edges.push({ id: `e${b}-${n}`, from: `b${b}`, to: `b${b}-${n}` }); }
  }
  const before = structuredClone({ nodes, edges }), result = prepareGeneratedMindMap(before), bounds = mapBounds(result.nodes);
  assert.equal(hasMapOverlaps(result.nodes, 12), false); assert.equal(result.nodes.length, 31); assert.equal(result.edges.length, 30);
  assert.ok(bounds.width < 1800, 'compact width'); assert.ok(bounds.height < 1300, 'balanced height');
  const root = result.nodes[0], branches = result.nodes.filter(n => /^b\d$/.test(n.id)); assert.ok(branches.some(n => n.x < root.x)); assert.ok(branches.some(n => n.x > root.x));
  assert.equal(root.fill, '#176d72'); assert.equal(root.bold, true); assert.ok(new Set(branches.map(n => n.fill)).size > 2);
  assert.deepEqual(result.nodes.map(n => n.text), nodes.map(n => n.text)); assert.deepEqual({ nodes, edges }, before);
  const wide = { nodes: [{ id: 'a', text: '宽标题', x: 0, y: 0, width: 640 }, { id: 'b', text: 'B', x: 9000, y: 0 }, { id: 'c', text: 'C', x: 18000, y: 0 }], edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }] };
  const tidy = autoLayout(wide, 'right'); assert.ok(tidy.nodes[2].x - tidy.nodes[1].x < 250, 'a wide root must not stretch every deeper level');
});

test('balanced layout handles cycles, shared nodes, disconnected components, long labels and style restoration', async () => {
  const { styleMindMap } = await import('../src/mindMapModel.js');
  const nodes = Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, text: `知识${i}中文ABC`.repeat(i % 3 + 1), x: 10, y: 10, shape: ['rectangle', 'circle', 'diamond'][i % 3] }));
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: i % 4 ? `n${i}` : 'n0', to: n.id })); edges.push({ id: 'cycle', from: 'n3', to: 'n0' }); edges.push({ id: 'shared', from: 'n12', to: 'n7' });
  const map = autoLayout({ nodes, edges }, 'balanced'); assert.equal(hasMapOverlaps(map.nodes, 12), false); assert.equal(map.nodes.length, 80); assert.deepEqual(map.edges, edges);
  const color = { nodes: [{ id: 'a', x: 0, y: 0, text: '主题', fill: '#ffffff' }], edges: [] }; assert.equal(styleMindMap(color).nodes[0].fill, '#ffffff'); assert.equal(styleMindMap(color, true).nodes[0].fill, '#176d72');
  const components = autoLayout({ nodes: nodes.slice(0, 5), edges: [] }, 'balanced'); assert.equal(hasMapOverlaps(components.nodes), false);
});
