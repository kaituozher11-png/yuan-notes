import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, Maximize2, Minimize2, Trash2, X, Plus, Minus, Undo2, Redo2, Copy, Hand, Scan, Download, Upload, Search } from 'lucide-react';
import { autoLayout, connectNodes, fitMapView, hasMapOverlaps, mapBounds, mapDimensions, MAX_MAP_SIZE, newNode, nodeSize, normalizeMap, placeNode, SHAPES, visibleMap } from './mindMapModel';
import { MapElements } from './MindMapSvg';
import './mindMap.css';

const initial = [{ id: 'root', text: '中心主题', x: 80, y: 110, shape: 'rectangle' }];
const shapeNames = { rectangle: '长方形', square: '正方形', circle: '圆形', ellipse: '椭圆形', diamond: '菱形' };
const styles = { curve: '曲线', straight: '直线', elbow: '折线' };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const id = () => crypto.randomUUID();

export default function MindMap({ value, onChange }) {
  const map = useMemo(() => { const next = normalizeMap(value); if (!next.nodes.length) next.nodes = initial; return next; }, [value]);
  const visible = useMemo(() => visibleMap(map), [map]);
  const [selection, setSelection] = useState([map.nodes[0].id]);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [connectFrom, setConnectFrom] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [full, setFull] = useState(false);
  const [focus, setFocus] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hand, setHand] = useState(false);
  const [selectArea, setSelectArea] = useState(false);
  const [area, setArea] = useState(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [layout, setLayout] = useState('right');
  const [format, setFormat] = useState('svg');
  const [exporting, setExporting] = useState(false);
  const [, refresh] = useState(0);
  const viewport = useRef(null), svg = useRef(null), titleInput = useRef(null), fileInput = useRef(null);
  const current = useRef(null), drag = useRef(null), pointerTouches = useRef(new Map()), pinch = useRef(null);
  const history = useRef({ past: [], future: [] });
  const pendingView = useRef(null);
  current.current = { map, onChange, zoom };
  const chosen = map.nodes.find(node => node.id === selection[0]);
  const chosenEdge = map.edges.find(edge => edge.id === selectedEdge);
  const overlaps = useMemo(() => hasMapOverlaps(map.nodes), [map.nodes]);

  function remember(before) { history.current.past.push(structuredClone(before)); if (history.current.past.length > 50) history.current.past.shift(); history.current.future = []; refresh(n => n + 1); }
  function save(next, record = true) {
    const before = current.current.map, normalized = normalizeMap(next);
    if (JSON.stringify(before) === JSON.stringify(normalized)) return;
    if (record) remember(before);
    current.current = { ...current.current, map: normalized };
    current.current.onChange(normalized);
  }
  function undo() { const previous = history.current.past.pop(); if (!previous) return; history.current.future.push(structuredClone(current.current.map)); save(previous, false); refresh(n => n + 1); setMessage('已撤销导图修改'); }
  function redo() { const next = history.current.future.pop(); if (!next) return; history.current.past.push(structuredClone(current.current.map)); save(next, false); refresh(n => n + 1); setMessage('已重做导图修改'); }
  function centerAt(x, y, nextZoom = current.current.zoom) { pendingView.current = { x, y }; setZoom(nextZoom); refresh(n => n + 1); }
  useEffect(() => {
    if (!pendingView.current || !viewport.current || !svg.current) return;
    const view = viewport.current, canvas = svg.current;
    const target = pendingView.current; pendingView.current = null;
    const rect = canvas.getBoundingClientRect(), outer = view.getBoundingClientRect();
    view.scrollLeft += rect.left - outer.left + target.x * zoom - view.clientWidth / 2;
    view.scrollTop += rect.top - outer.top + target.y * zoom - view.clientHeight / 2;
  });
  function fit(nodes = visible.nodes) { const view = viewport.current; if (!view) return; const result = fitMapView(nodes, view.clientWidth, view.clientHeight); centerAt(result.x, result.y, result.zoom); }
  function changeZoom(next, point) {
    const view = viewport.current, canvas = svg.current; if (!view || !canvas) return;
    const rect = canvas.getBoundingClientRect(), outer = view.getBoundingClientRect();
    const x = point?.x ?? outer.left + view.clientWidth / 2, y = point?.y ?? outer.top + view.clientHeight / 2;
    const world = { x: (x - rect.left) / current.current.zoom, y: (y - rect.top) / current.current.zoom };
    pendingView.current = { x: world.x + (view.clientWidth / 2 - (x - outer.left)) / next, y: world.y + (view.clientHeight / 2 - (y - outer.top)) / next };
    setZoom(clamp(next, .02, 3));
  }
  useEffect(() => {
    const view = viewport.current; if (!view) return;
    const wheel = event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); changeZoom(clamp(current.current.zoom * (event.deltaY > 0 ? .9 : 1.1), .02, 3), { x: event.clientX, y: event.clientY }); } };
    view.addEventListener('wheel', wheel, { passive: false });
    return () => view.removeEventListener('wheel', wheel);
  }, [full]);
  useEffect(() => { if (full) requestAnimationFrame(() => fit()); }, [full]);
  useEffect(() => { if (!full) return; const escape = event => { if (event.key === 'Escape') setFull(false); }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [full]);

  function add(shape, position) {
    const previous = current.current.map;
    if (previous.nodes.length >= 500) return setMessage('一张导图最多500个节点，请另建一张导图');
    const node = newNode(previous.nodes, id(), shape, previous);
    if (position) Object.assign(node, placeNode(position.x, position.y, node, { width: MAX_MAP_SIZE, height: MAX_MAP_SIZE }));
    const next = { ...previous, nodes: [...previous.nodes, node] };
    save(next); setSelection([node.id]); setSelectedEdge(null); centerAt(node.x + nodeSize(node).width / 2, node.y + nodeSize(node).height / 2);
  }
  function pickNode(event, node) {
    if (connecting) {
      if (!connectFrom) { setConnectFrom(node.id); return; }
      const previous = current.current.map, edges = connectNodes(previous.edges, connectFrom, node.id, id());
      if (edges !== previous.edges) { save({ ...previous, edges }); setSelectedEdge(edges.at(-1).id); setSelection([]); }
      else setMessage('不能连接自身，也不能重复连接相同节点');
      setConnecting(false); setConnectFrom(null); return;
    }
    setSelectedEdge(null);
    setSelection(old => event.shiftKey ? old.includes(node.id) ? old.filter(key => key !== node.id) : [...old, node.id] : old.includes(node.id) ? old : [node.id]);
  }
  function changeNode(changes) { const previous = current.current.map; save({ ...previous, nodes: previous.nodes.map(node => selection.includes(node.id) ? { ...node, ...changes } : node) }); }
  function changeEdge(changes) { const previous = current.current.map; save({ ...previous, edges: previous.edges.map(edge => edge.id === selectedEdge ? { ...edge, ...changes } : edge) }); }
  function remove() {
    const previous = current.current.map;
    if (selectedEdge) { save({ ...previous, edges: previous.edges.filter(edge => edge.id !== selectedEdge) }); setSelectedEdge(null); return; }
    const ids = new Set(selection);
    if (!ids.size) return;
    const nodes = previous.nodes.filter(node => !ids.has(node.id));
    if (!nodes.length) return setMessage('请至少保留一个节点');
    save({ ...previous, nodes, edges: previous.edges.filter(edge => !ids.has(edge.from) && !ids.has(edge.to)) }); setSelection([]);
  }
  function duplicate() {
    const previous = current.current.map;
    const selected = previous.nodes.filter(node => selection.includes(node.id));
    if (!selected.length) return;
    if (previous.nodes.length + selected.length > 500) return setMessage('复制后超过500个节点，请减少选择');
    const ids = new Map(selected.map(node => [node.id, id()]));
    const bounds = mapBounds(selected, 0), all = mapBounds(previous.nodes, 50);
    const copies = selected.map(node => ({ ...node, id: ids.get(node.id), x: node.x - bounds.x + 50, y: node.y - bounds.y + all.y + all.height + 40 }));
    if (mapBounds(copies).y + mapBounds(copies).height > MAX_MAP_SIZE) return setMessage('已到画布边界，请整理布局后再复制');
    const edges = previous.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(edge => ({ ...edge, id: id(), from: ids.get(edge.from), to: ids.get(edge.to) }));
    save({ ...previous, nodes: [...previous.nodes, ...copies], edges: [...previous.edges, ...edges] }); setSelection(copies.map(node => node.id)); fit(copies);
  }
  function arrange() { try { const next = autoLayout(current.current.map, layout); save(next); setMessage('已整理布局，可撤销恢复原位置'); requestAnimationFrame(() => fit(visibleMap(next).nodes)); } catch (error) { setMessage(error.message); } }
  function expand(axis) {
    const previous = current.current.map;
    const changes = axis === 'width' ? { width: Math.min(MAX_MAP_SIZE, previous.width + 800) } : axis === 'height' ? { height: Math.min(MAX_MAP_SIZE, previous.height + 600) } : { width: Math.min(MAX_MAP_SIZE, previous.width + 800), height: Math.min(MAX_MAP_SIZE, previous.height + 600) };
    if (Object.entries(changes).every(([key, value]) => previous[key] === value)) return setMessage('画布已到32000像素上限');
    save({ ...previous, ...changes }); setMessage('画布已扩展，原节点大小和位置保留，可滚动或拖动画布');
  }
  function coordinate(event) { const rect = svg.current.getBoundingClientRect(); return { x: (event.clientX - rect.left) / current.current.zoom, y: (event.clientY - rect.top) / current.current.zoom }; }
  function nodeDown(event, node) {
    if (pinch.current || hand || event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault(); event.stopPropagation(); pickNode(event, node);
    if (connecting || event.shiftKey) return;
    const previous = current.current.map, point = coordinate(event);
    const ids = selection.includes(node.id) ? selection : [node.id];
    drag.current = { type: 'nodes', pointerId: event.pointerId, start: point, before: structuredClone(previous), ids, moved: false };
    svg.current.setPointerCapture(event.pointerId);
  }
  function backgroundDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (!hand && event.target.closest('.mindmap-node,.mindmap-edge')) return;
    event.preventDefault();
    if (selectArea && !hand && event.button === 0) { const point = coordinate(event); drag.current = { type: 'area', pointerId: event.pointerId, start: point }; setArea({ x: point.x, y: point.y, width: 0, height: 0 }); }
    else drag.current = { type: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop };
    svg.current.setPointerCapture(event.pointerId);
  }
  function move(event) {
    const state = drag.current; if (!state || state.pointerId !== event.pointerId || pinch.current) return;
    if (state.type === 'pan') { viewport.current.scrollLeft = state.left - event.clientX + state.x; viewport.current.scrollTop = state.top - event.clientY + state.y; return; }
    const point = coordinate(event);
    if (state.type === 'area') { setArea({ x: Math.min(point.x, state.start.x), y: Math.min(point.y, state.start.y), width: Math.abs(point.x - state.start.x), height: Math.abs(point.y - state.start.y) }); return; }
    let dx = point.x - state.start.x, dy = point.y - state.start.y;
    const moving = state.before.nodes.filter(node => state.ids.includes(node.id)), bounds = mapBounds(moving, 0);
    dx = clamp(dx, 12 - bounds.x, MAX_MAP_SIZE - bounds.x - bounds.width - 40); dy = clamp(dy, 12 - bounds.y, MAX_MAP_SIZE - bounds.y - bounds.height - 40);
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    state.moved = true;
    save({ ...state.before, nodes: state.before.nodes.map(node => state.ids.includes(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node), ...mapDimensions(current.current.map) }, false);
  }
  function finish(event) {
    const state = drag.current;
    if (state?.pointerId === event.pointerId) {
      if (state.type === 'nodes' && state.moved) remember(state.before);
      if (state.type === 'area' && area) setSelection(visible.nodes.filter(node => { const size = nodeSize(node); return node.x < area.x + area.width && node.x + size.width > area.x && node.y < area.y + area.height && node.y + size.height > area.y; }).map(node => node.id));
      drag.current = null; setArea(null);
    }
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
  }
  function touchDown(event) {
    if (event.pointerType !== 'touch') return;
    pointerTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerTouches.current.size === 2) { if (drag.current?.moved) remember(drag.current.before); drag.current = null; const [a, b] = [...pointerTouches.current.values()]; pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: current.current.zoom }; event.stopPropagation(); }
  }
  function touchMove(event) {
    if (!pointerTouches.current.has(event.pointerId)) return;
    pointerTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointerTouches.current.size === 2) { event.preventDefault(); event.stopPropagation(); const [a, b] = [...pointerTouches.current.values()]; changeZoom(clamp(pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.current.distance), .02, 3), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); }
  }
  function touchUp(event) { pointerTouches.current.delete(event.pointerId); if (pinch.current) { pinch.current = null; drag.current = null; } }
  function keyboard(event) {
    if (event.target.closest('input,textarea,select,button') || event.target.isContentEditable) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) redo(); else undo(); }
    else if (ctrl && event.key.toLowerCase() === 'y') { event.preventDefault(); event.stopPropagation(); redo(); }
    else if (ctrl && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); setSelection(visible.nodes.map(node => node.id)); }
    else if (ctrl && event.key.toLowerCase() === 'd') { event.preventDefault(); event.stopPropagation(); duplicate(); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); remove(); }
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && selection.length) {
      event.preventDefault(); const step = event.shiftKey ? 20 : 4, dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      const previous = current.current.map;
      save({ ...previous, nodes: previous.nodes.map(node => selection.includes(node.id) ? { ...node, ...placeNode(node.x + dx, node.y + dy, node, { width: MAX_MAP_SIZE, height: MAX_MAP_SIZE }) } : node) });
    }
  }
  function findNode() { const match = visible.nodes.find(node => node.text?.toLocaleLowerCase().includes(query.toLocaleLowerCase())); if (match && query.trim()) { setSelection([match.id]); const size = nodeSize(match); centerAt(match.x + size.width / 2, match.y + size.height / 2, Math.max(.65, zoom)); } else setMessage('没有找到可见的匹配节点，可先展开全部'); }
  async function exportMap() { setExporting(true); try { const { exportMindMap } = await import('./mindMapExport'); await exportMindMap(current.current.map, format); setMessage('已导出完整导图（包括折叠内容）'); } catch (error) { setMessage(error.message); } finally { setExporting(false); } }

  const editor = <div className={`mindmap mindmap-editor-v2 ${full ? 'mindmap-fullscreen' : ''} ${focus ? 'mindmap-focus' : ''}`} role="region" aria-label="思维导图编辑器" onKeyDown={keyboard}>
    <div className="mindmap-tools">
      <div className="mindmap-shapes" role="group" aria-label="拖入节点图形">{SHAPES.map(shape => <button key={shape} type="button" draggable title={`拖入${shapeNames[shape]}节点；点击也可添加`} aria-label={`添加${shapeNames[shape]}节点`} onDragStart={event => event.dataTransfer.setData('application/x-yingxing-map-shape', shape)} onClick={() => add(shape)}><span className={`mindmap-shape-icon shape-${shape}`}/>{shapeNames[shape]}</button>)}</div>
      <button type="button" className={connecting ? 'active' : ''} aria-label="连接节点" aria-pressed={connecting} onClick={() => { setConnecting(!connecting); setConnectFrom(null); setSelectedEdge(null); }}><Link2 size={16}/>连线</button>
      <button type="button" aria-label="复制选中节点" disabled={!selection.length} onClick={duplicate}><Copy size={16}/></button>
      <button type="button" aria-label={selectedEdge ? '删除连接线' : '删除节点'} disabled={!selectedEdge && !selection.length} onClick={remove}><Trash2 size={16}/></button>
      <button type="button" aria-label="撤销导图操作" disabled={!history.current.past.length} onClick={undo}><Undo2 size={16}/></button><button type="button" aria-label="重做导图操作" disabled={!history.current.future.length} onClick={redo}><Redo2 size={16}/></button>
      <button type="button" aria-pressed={focus} onClick={() => setFocus(!focus)}>{focus ? '显示全部工具' : '专注画布'}</button>
      <button type="button" className="mindmap-expand" aria-label={full ? '退出全屏' : '全屏编辑'} onClick={() => setFull(!full)}>{full ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>
    </div>
    <div className="mindmap-tools mindmap-view-tools">
      <button type="button" aria-label="扩展画布" onClick={() => expand('both')}><Plus size={16}/>扩展画布</button><button type="button" aria-label="横向扩展画布" onClick={() => expand('width')}>加宽</button><button type="button" aria-label="纵向扩展画布" onClick={() => expand('height')}>加高</button>
      <select aria-label="自动布局方向" value={layout} onChange={event => setLayout(event.target.value)}><option value="right">向右树形</option><option value="down">向下树形</option><option value="grid">网格整理</option></select><button type="button" onClick={arrange}>自动排版</button>
      <button type="button" className={hand ? 'active' : ''} aria-label="拖动画布" aria-pressed={hand} onClick={() => { setHand(!hand); setSelectArea(false); }}><Hand size={16}/></button><button type="button" className={selectArea ? 'active' : ''} aria-label="框选导图节点" aria-pressed={selectArea} onClick={() => { setSelectArea(!selectArea); setHand(false); }}><Scan size={16}/></button>
      <button type="button" aria-label="缩小导图" disabled={zoom <= .02} onClick={() => changeZoom(Math.max(.02, zoom / 1.25))}><Minus size={16}/></button><output aria-label="导图缩放">{Math.round(zoom * 100)}%</output><button type="button" aria-label="放大导图" disabled={zoom >= 3} onClick={() => changeZoom(Math.min(3, zoom * 1.25))}><Plus size={16}/></button>
      <button type="button" onClick={() => fit()}>适应内容</button><button type="button" onClick={() => changeZoom(1)}>100%</button>
    </div>
    <div className="mindmap-properties">
      {chosenEdge ? <>
        <label>连线文字<input aria-label="连线文字" maxLength={300} value={chosenEdge.text || ''} onChange={event => changeEdge({ text: event.target.value })}/></label>
        <label>线条<select aria-label="连接线样式" value={chosenEdge.style || 'curve'} onChange={event => changeEdge({ style: event.target.value })}>{Object.entries(styles).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label>颜色<input type="color" aria-label="连接线颜色" value={chosenEdge.color || '#618e90'} onChange={event => changeEdge({ color: event.target.value })}/></label>
        <label>粗细<input type="range" aria-label="连接线粗细" min="1" max="8" value={chosenEdge.width || 2} onChange={event => changeEdge({ width: Number(event.target.value) })}/></label>
        <label><input type="checkbox" aria-label="连接线箭头" checked={!!chosenEdge.arrow} onChange={event => changeEdge({ arrow: event.target.checked })}/>箭头</label><label><input type="checkbox" aria-label="连接线虚线" checked={!!chosenEdge.dashed} onChange={event => changeEdge({ dashed: event.target.checked })}/>虚线</label>
      </> : chosen ? <>
        <label className="map-text-field">节点文字<textarea ref={titleInput} aria-label="节点文字" maxLength={1000} value={chosen.text || ''} onChange={event => changeNode({ text: event.target.value })}/></label>
        <label>形状<select aria-label="节点形状" value={chosen.shape || 'rectangle'} onChange={event => changeNode({ shape: event.target.value })}>{SHAPES.map(shape => <option key={shape} value={shape}>{shapeNames[shape]}</option>)}</select></label>
        <label>宽度<input type="number" aria-label="节点宽度" min={86} max={640} value={chosen.width || nodeSize(chosen).width} onChange={event => { const width = Number(event.target.value); if (width >= 86 && width <= 640) changeNode({ width }); }}/></label>
        <label>字号<input type="number" aria-label="节点字号" min={12} max={28} value={chosen.fontSize || 15} onChange={event => { const fontSize = Number(event.target.value); if (fontSize >= 12 && fontSize <= 28) changeNode({ fontSize }); }}/></label>
        <label>底色<input type="color" aria-label="节点底色" value={chosen.fill || '#ffffff'} onChange={event => changeNode({ fill: event.target.value })}/></label><label>文字色<input type="color" aria-label="节点文字色" value={chosen.textColor || '#254c50'} onChange={event => changeNode({ textColor: event.target.value })}/></label><label>边框<input type="color" aria-label="节点边框色" value={chosen.color || '#83aaa9'} onChange={event => changeNode({ color: event.target.value })}/></label>
        <button type="button" className={chosen.bold ? 'active' : ''} onClick={() => changeNode({ bold: !chosen.bold })}>加粗节点</button><button type="button" onClick={() => changeNode({ collapsed: !chosen.collapsed })}>{chosen.collapsed ? '展开选中分支' : '折叠选中分支'}</button>
      </> : <span>点击节点或连线编辑；Shift点选可多选，双击节点编辑文字。</span>}
      {selection.length > 1 && <span>已选择{selection.length}个节点，样式修改将应用到全部选择。</span>}
      {connecting && <span className="mindmap-connect-status">{connectFrom ? '选择终点节点' : '选择起点节点'}<button type="button" aria-label="取消连线" onClick={() => { setConnecting(false); setConnectFrom(null); }}><X size={14}/></button></span>}
    </div>
    <div className="mindmap-tools mindmap-file-tools"><div className="map-search"><input aria-label="查找导图节点" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); findNode(); } }}/><button type="button" aria-label="定位匹配节点" onClick={findNode}><Search size={15}/></button></div><button type="button" onClick={() => { save({ ...current.current.map, nodes: current.current.map.nodes.map(node => ({ ...node, collapsed: false })) }); }}>展开全部</button>
      <select aria-label="导图导出格式" value={format} onChange={event => setFormat(event.target.value)}><option value="svg">SVG矢量图</option><option value="png">PNG图片</option><option value="json">JSON可编辑文件</option></select><button type="button" disabled={exporting} onClick={exportMap}><Download size={15}/>{exporting ? '正在导出' : '导出导图'}</button><button type="button" onClick={() => fileInput.current.click()}><Upload size={15}/>导入导图</button>
      <input type="file" hidden ref={fileInput} accept=".json,application/json" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { if (file.size > 2_000_000) throw new Error('导图文件不能超过2MB'); const { parseMindMapFile } = await import('./mindMapExport'); const next = parseMindMapFile(await file.text()); if (!next.nodes.length) throw new Error('导图必须至少有一个节点'); if (!confirm('导入后替换当前导图，可撤销恢复，是否继续？')) return; save(next); setSelection([next.nodes[0].id]); setSelectedEdge(null); requestAnimationFrame(() => fit(next.nodes)); setMessage('导图已导入'); } catch (error) { setMessage(error.message); } }}/>
    </div>
    <div className="map-summary"><span>{map.nodes.length}个节点 · {map.edges.length}条线 · 画布{Math.ceil(map.width)} × {Math.ceil(map.height)}{visible.hiddenCount ? ` · 已折叠${visible.hiddenCount}个节点` : ''}</span>{overlaps && <button type="button" onClick={arrange}>检测到重叠，点击自动排版</button>}</div>
    {message && <p className="map-feedback" role="status">{message}</p>}
    <div ref={viewport} className="mindmap-viewport" tabIndex={0} aria-label="导图视区" onPointerDownCapture={touchDown} onPointerMoveCapture={touchMove} onPointerUpCapture={touchUp} onPointerCancelCapture={touchUp}>
      <div className="mindmap-stage" style={{ width: map.width * zoom, height: map.height * zoom }}>
        <svg ref={svg} style={{ width: map.width * zoom, height: map.height * zoom }} width={map.width * zoom} height={map.height * zoom} viewBox={`0 0 ${map.width} ${map.height}`} aria-label="思维导图画布"
          onDragOver={event => { if ([...event.dataTransfer.types].includes('application/x-yingxing-map-shape')) event.preventDefault(); }} onDrop={event => { const shape = event.dataTransfer.getData('application/x-yingxing-map-shape'); if (SHAPES.includes(shape)) { event.preventDefault(); add(shape, coordinate(event)); } }}
          onPointerDown={backgroundDown} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
          <rect width={map.width} height={map.height} fill="transparent"/>
          <MapElements nodes={visible.nodes} edges={visible.edges} selected={selection} selectedEdge={selectedEdge} search={query} interactive onNodeDown={nodeDown} onNodeDoubleClick={() => { titleInput.current?.focus(); titleInput.current?.select(); }} onNodeKey={(event, node) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickNode(event, node); } }} onEdge={edge => { setSelectedEdge(edge); setSelection([]); setConnecting(false); }} onFold={node => { const previous = current.current.map; save({ ...previous, nodes: previous.nodes.map(item => item.id === node.id ? { ...item, collapsed: !item.collapsed } : item) }); }}/>
          {area && <rect x={area.x} y={area.y} width={area.width} height={area.height} fill="#237f7a22" stroke="#237f7a" strokeDasharray="5 3" pointerEvents="none"/>}
        </svg>
      </div>
    </div>
    <small className="map-hint">空白处拖动平移 · Ctrl/⌘+滚轮缩放 · 触屏双指缩放 · Shift点选/框选多选 · 方向键微调 · Ctrl/⌘+D复制 · Ctrl/⌘+Z撤销</small>
  </div>;
  return full ? createPortal(editor, document.body) : editor;
}
