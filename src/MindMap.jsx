import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, Maximize2, Minimize2, Trash2, X } from 'lucide-react';
import { connectNodes, edgeLabelPosition, edgePath, MAP_HEIGHT, MAP_WIDTH, newNode, nodeSize, normalizeMap, placeNode } from './mindMapModel';
import './mindMap.css';

const initial = [{ id: 'root', text: '中心主题', x: 70, y: 110, shape: 'rectangle' }];
const shapes = [['rectangle', '长方形'], ['square', '正方形'], ['circle', '圆形'], ['ellipse', '椭圆形'], ['diamond', '菱形']];
const styles = { curve: '曲线', straight: '直线', elbow: '折线' };

function NodeShape({ node, selected }) {
  const { width, height } = nodeSize(node);
  const common = { fill: selected ? '#176d72' : '#fff', stroke: selected ? '#176d72' : '#96b8b7', strokeWidth: 2 };
  if (node.shape === 'circle') return <circle cx={width / 2} cy={height / 2} r={width / 2 - 2} {...common}/>;
  if (node.shape === 'ellipse') return <ellipse cx={width / 2} cy={height / 2} rx={width / 2 - 2} ry={height / 2 - 2} {...common}/>;
  if (node.shape === 'diamond') return <polygon points={`${width / 2},2 ${width - 2},${height / 2} ${width / 2},${height - 2} 2,${height / 2}`} {...common}/>;
  return <rect width={width} height={height} rx={node.shape === 'square' ? 4 : 6} {...common}/>;
}

export default function MindMap({ value, onChange }) {
  const map = normalizeMap(value);
  const nodes = map.nodes.length ? map.nodes : initial;
  const edges = map.edges;
  const [selectedNode, setSelectedNode] = useState(nodes[0].id);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [connectFrom, setConnectFrom] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [full, setFull] = useState(false);
  const drag = useRef(null);
  const chosen = nodes.find((node) => node.id === selectedNode);
  const chosenEdge = edges.find((edge) => edge.id === selectedEdge);

  useEffect(() => {
    if (!full) return;
    function escape(event) { if (event.key === 'Escape') setFull(false); }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [full]);

  function save(nextNodes = nodes, nextEdges = edges) { onChange({ nodes: nextNodes, edges: nextEdges }); }
  function add(shape, position) {
    const node = { ...newNode(nodes, crypto.randomUUID(), shape), ...(position ? placeNode(position.x, position.y, { shape }) : {}) };
    save([...nodes, node]);
    setSelectedNode(node.id);
    setSelectedEdge(null);
  }
  function pickNode(id) {
    if (connecting) {
      if (!connectFrom) { setConnectFrom(id); return; }
      const next = connectNodes(edges, connectFrom, id, crypto.randomUUID());
      if (next !== edges) { save(nodes, next); setSelectedEdge(next.at(-1).id); setSelectedNode(null); }
      setConnectFrom(null);
      setConnecting(false);
      return;
    }
    setSelectedNode(id);
    setSelectedEdge(null);
  }
  function updateNode(changes) { save(nodes.map((node) => node.id === chosen?.id ? { ...node, ...changes } : node)); }
  function updateEdge(changes) { save(nodes, edges.map((edge) => edge.id === chosenEdge?.id ? { ...edge, ...changes } : edge)); }
  function removeSelection() {
    if (chosenEdge) { save(nodes, edges.filter((edge) => edge.id !== chosenEdge.id)); setSelectedEdge(null); return; }
    if (!chosen || nodes.length === 1) return;
    save(nodes.filter((node) => node.id !== chosen.id), edges.filter((edge) => edge.from !== chosen.id && edge.to !== chosen.id));
    setSelectedNode(nodes.find((node) => node.id !== chosen.id).id);
  }
  function canvasPosition(svg, event) {
    const rect = svg.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * MAP_WIDTH / rect.width, y: (event.clientY - rect.top) * MAP_HEIGHT / rect.height };
  }
  function move(event) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const point = canvasPosition(event.currentTarget, event);
    save(nodes.map((node) => node.id === current.id ? { ...node, ...placeNode(point.x - current.dx, point.y - current.dy, node) } : node));
  }

  const editor = <div className={`mindmap ${full ? 'mindmap-fullscreen' : ''}`} role="region" aria-label="思维导图编辑器">
    <div className="mindmap-tools">
      <div className="mindmap-shapes" role="group" aria-label="拖入节点图形">
        {shapes.map(([shape, label]) => <button key={shape} type="button" draggable title={`拖入${label}节点；点击也可添加`} aria-label={`添加${label}节点`}
          onDragStart={(event) => event.dataTransfer.setData('application/x-yingxing-map-shape', shape)} onClick={() => add(shape)}>
          <span className={`mindmap-shape-icon shape-${shape}`}/><span>{label}</span>
        </button>)}
      </div>
      <button type="button" className={connecting ? 'active' : ''} aria-label="连接节点" aria-pressed={connecting} title="依次选择两个节点连线"
        onClick={() => { setConnecting(!connecting); setConnectFrom(null); setSelectedEdge(null); }}><Link2 size={16}/> 连线</button>
      <button type="button" onClick={removeSelection} disabled={selectedEdge ? false : nodes.length <= 1} title={selectedEdge ? '删除连接线' : '删除节点'} aria-label={selectedEdge ? '删除连接线' : '删除节点'}><Trash2 size={16}/></button>
      <button type="button" className="mindmap-expand" onClick={() => setFull(!full)} title={full ? '退出全屏' : '全屏编辑'} aria-label={full ? '退出全屏' : '全屏编辑'}>{full ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>
    </div>
    <div className="mindmap-properties">
      {chosenEdge ? <>
        <label>连线文字<input aria-label="连线文字" maxLength={60} value={chosenEdge.text || ''} onChange={(event) => updateEdge({ text: event.target.value })}/></label>
        <label>线条<select aria-label="连接线样式" value={chosenEdge.style || 'curve'} onChange={(event) => updateEdge({ style: event.target.value })}>{Object.entries(styles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>颜色<input type="color" aria-label="连接线颜色" value={chosenEdge.color || '#618e90'} onChange={(event) => updateEdge({ color: event.target.value })}/></label>
        <label>粗细<input type="range" aria-label="连接线粗细" min="1" max="6" value={chosenEdge.width || 2} onChange={(event) => updateEdge({ width: Number(event.target.value) })}/></label>
      </> : chosen && <label>节点文字<input aria-label="节点文字" maxLength={60} value={chosen.text || ''} onChange={(event) => updateNode({ text: event.target.value })}/></label>}
      {connecting && <span className="mindmap-connect-status">{connectFrom ? '选择终点节点' : '选择起点节点'} <button type="button" title="取消连线" aria-label="取消连线" onClick={() => { setConnecting(false); setConnectFrom(null); }}><X size={14}/></button></span>}
    </div>
    <div className="mindmap-viewport">
      <svg width={MAP_WIDTH} height={MAP_HEIGHT} viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} aria-label="思维导图画布"
        onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes('application/x-yingxing-map-shape')) event.preventDefault(); }}
        onDrop={(event) => { const shape = event.dataTransfer.getData('application/x-yingxing-map-shape'); if (!shapes.some(([key]) => key === shape)) return; event.preventDefault(); add(shape, canvasPosition(event.currentTarget, event)); }}
        onPointerMove={move} onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}>
        {edges.map((edge) => {
          const from = nodes.find((node) => node.id === edge.from);
          const to = nodes.find((node) => node.id === edge.to);
          if (!from || !to) return null;
          const path = edgePath(from, { ...to, style: edge.style });
          const label = edgeLabelPosition(from, to);
          return <g key={edge.id} className={`mindmap-edge ${selectedEdge === edge.id ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`连接线：${from.text} 到 ${to.text}${edge.text ? `，${edge.text}` : ''}`}
            onClick={() => { setSelectedEdge(edge.id); setSelectedNode(null); setConnecting(false); setConnectFrom(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedEdge(edge.id); setSelectedNode(null); } }}>
            <path d={path} stroke={edge.color || '#618e90'} strokeWidth={edge.width || 2} fill="none"/>
            <path d={path} stroke="transparent" strokeWidth="18" fill="none"/>
            {edge.text && <g transform={`translate(${label.x} ${label.y})`}><rect x={-Math.max(24, edge.text.length * 8) / 2 - 6} y="-13" width={Math.max(24, edge.text.length * 8) + 12} height="22" rx="3" fill="white" stroke="#cbdedd"/><text textAnchor="middle" dominantBaseline="middle" fill="#36595d" fontSize="13">{edge.text}</text></g>}
          </g>;
        })}
        {nodes.map((node) => {
          const { width, height } = nodeSize(node);
          return <g key={node.id} className="mindmap-node" transform={`translate(${node.x} ${node.y})`}
            role="button" tabIndex={0} aria-label={`节点：${node.text || '未命名'}`} aria-pressed={selectedNode === node.id}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickNode(node.id); } }}
            onPointerDown={(event) => {
              if (event.pointerType === 'mouse' && event.button !== 0) return;
              event.preventDefault(); pickNode(node.id);
              if (connecting) return;
              event.currentTarget.ownerSVGElement.setPointerCapture(event.pointerId);
              const point = canvasPosition(event.currentTarget.ownerSVGElement, event);
              drag.current = { id: node.id, pointerId: event.pointerId, dx: point.x - node.x, dy: point.y - node.y };
            }}>
            <NodeShape node={node} selected={selectedNode === node.id || connectFrom === node.id}/>
            <foreignObject x="8" y="5" width={width - 16} height={height - 10}><div xmlns="http://www.w3.org/1999/xhtml" className={selectedNode === node.id ? 'mindmap-node-label selected' : 'mindmap-node-label'}>{node.text || '未命名'}</div></foreignObject>
          </g>;
        })}
      </svg>
    </div>
  </div>;
  return full ? createPortal(editor, document.body) : editor;
}
