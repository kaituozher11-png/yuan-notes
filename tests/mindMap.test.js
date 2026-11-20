import test from 'node:test';
import assert from 'node:assert/strict';
import { connectNodes, edgePath, newNode, nodeSize, normalizeMap, placeNode, MAP_WIDTH, MAP_HEIGHT, NODE_WIDTH, NODE_HEIGHT } from '../src/mindMapModel.js';

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
