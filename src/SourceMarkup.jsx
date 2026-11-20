import { useEffect, useRef, useState } from 'react';
import { EyeOff, Trash2 } from 'lucide-react';

const emptyMarkup = { strokes: [], stickies: [] };
const clamp = (value) => Math.max(0, Math.min(1, value));

function FireflyOutline() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.5 3 9 1.5M13.5 3 15 1.5" />
    <circle cx="12" cy="5" r="2" />
    <path d="M10 9C6 6 3 7 4 11c.6 2 3 3 6 2m4-4c4-3 7-2 6 2-.6 2-3 3-6 2" />
    <path d="M10 9c-1 3-.5 8 2 11 2.5-3 3-8 2-11" />
    <path d="M10.6 16.5h2.8" />
  </svg>;
}

export default function SourceMarkup({ value, onChange, tool, color, size, showStickies, onStickyPlaced }) {
  const root = useRef(null);
  const canvas = useRef(null);
  const current = useRef(null);
  const dragging = useRef(null);
  const markerDrag = useRef(null);
  const suppressMarkerClick = useRef(null);
  const markup = useRef(value || emptyMarkup);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [newSticky, setNewSticky] = useState(null);
  const [openedStickyId, setOpenedStickyId] = useState(null);
  markup.current = value || emptyMarkup;
  useEffect(() => { setOpenedStickyId(null); }, [showStickies]);

  function commit(next, immediate = false) {
    markup.current = next;
    onChange(next, immediate);
  }
  function position(event) {
    const rect = root.current.getBoundingClientRect();
    return [clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height)];
  }
  function paint() {
    const element = canvas.current;
    if (!element || !dimensions.width || !dimensions.height) return;
    const context = element.getContext('2d');
    const scale = window.devicePixelRatio || 1;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, dimensions.width, dimensions.height);
    for (const stroke of [...markup.current.strokes, ...(current.current ? [current.current] : [])]) {
      const points = stroke.points;
      if (!points.length) continue;
      context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
      context.globalAlpha = stroke.tool === 'highlighter' ? .38 : 1;
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.size;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(points[0][0] * dimensions.width, points[0][1] * dimensions.height);
      for (const point of points.slice(1)) context.lineTo(point[0] * dimensions.width, point[1] * dimensions.height);
      if (points.length === 1) context.lineTo(points[0][0] * dimensions.width + .01, points[0][1] * dimensions.height + .01);
      context.stroke();
    }
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
  }
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const scale = window.devicePixelRatio || 1;
      canvas.current.width = Math.round(width * scale);
      canvas.current.height = Math.round(height * scale);
      setDimensions({ width, height });
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { paint(); }, [value?.strokes, dimensions]);
  useEffect(() => {
    if (!newSticky) return;
    root.current?.querySelector(`[data-sticky-id="${newSticky}"] textarea`)?.focus();
    setNewSticky(null);
  }, [newSticky, value]);

  function down(event) {
    if (!tool || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    if (tool === 'sticky') {
      const [x, y] = position(event);
      const id = crypto.randomUUID();
      commit({ ...markup.current, stickies: [...markup.current.stickies, { id, x, y, text: '', collapsed: false }] }, true);
      if (!showStickies) setOpenedStickyId(id);
      setNewSticky(id);
      onStickyPlaced?.();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    current.current = { tool, color, size: tool === 'eraser' ? Math.max(18, size * 3) : tool === 'highlighter' ? Math.max(14, size * 4) : size, points: [position(event)] };
    paint();
  }
  function move(event) {
    if (!current.current) return;
    const point = position(event);
    const last = current.current.points.at(-1);
    if (Math.hypot((point[0] - last[0]) * dimensions.width, (point[1] - last[1]) * dimensions.height) < 2) return;
    if (current.current.points.length < 2500) current.current.points.push(point);
    paint();
  }
  function up(event) {
    if (!current.current) return;
    move(event);
    const stroke = current.current;
    current.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    commit({ ...markup.current, strokes: [...markup.current.strokes, stroke] }, true);
    paint();
  }
  function cancel(event) {
    current.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    paint();
  }
  function changeSticky(id, change, immediate = false) {
    commit({ ...markup.current, stickies: markup.current.stickies.map((item) => item.id === id ? { ...item, ...change } : item) }, immediate);
  }
  function markerPosition(element) {
    const markerRect = element.getBoundingClientRect();
    const pageRect = root.current.getBoundingClientRect();
    return {
      x: (markerRect.left + markerRect.width / 2 - pageRect.left) / pageRect.width,
      y: (markerRect.top + markerRect.height / 2 - pageRect.top) / pageRect.height,
      minX: markerRect.width / 2 / pageRect.width,
      minY: markerRect.height / 2 / pageRect.height,
      width: pageRect.width,
      height: pageRect.height,
    };
  }
  function boundMarker(value, minimum) {
    return Math.max(minimum, Math.min(1 - minimum, value));
  }
  function moveSticky(event) {
    if (!dragging.current || dragging.current.pointerId !== event.pointerId) return;
    const { id, x, y, clientX, clientY, width, height } = dragging.current;
    changeSticky(id, { x: clamp(x + (event.clientX - clientX) / width), y: clamp(y + (event.clientY - clientY) / height) });
  }
  function stopSticky(event) {
    if (dragging.current?.pointerId !== event.pointerId) return;
    dragging.current = null;
    commit(markup.current, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function moveMarker(event) {
    const drag = markerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.clientX;
    const dy = event.clientY - drag.clientY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    changeSticky(drag.id, {
      x: boundMarker(drag.x + dx / drag.width, drag.minX),
      y: boundMarker(drag.y + dy / drag.height, drag.minY),
    });
  }
  function stopMarker(event) {
    const drag = markerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      moveMarker(event);
      commit(markup.current, true);
      suppressMarkerClick.current = drag.id;
      setTimeout(() => { if (suppressMarkerClick.current === drag.id) suppressMarkerClick.current = null; }, 0);
    }
    markerDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function openMarker(sticky) {
    if (suppressMarkerClick.current === sticky.id) { suppressMarkerClick.current = null; return; }
    if (showStickies) changeSticky(sticky.id, { collapsed: false }, true);
    else setOpenedStickyId(sticky.id);
  }
  return <div ref={root} className="source-markup-layer">
    <canvas ref={canvas} className={`source-ink ${tool ? 'active' : ''}`} data-tool={tool || ''} aria-label="原文标记区域" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} />
    {markup.current.stickies.map((sticky, index) => {
      const visible = openedStickyId === sticky.id || (showStickies && !sticky.collapsed);
      if (!visible) return <button
        key={sticky.id}
        type="button"
        className="source-sticky-marker"
        aria-label={`打开第 ${index + 1} 张便利贴`}
        title="点击展开，拖动移动便利贴"
        style={{ left: `${Math.max(0, Math.min(dimensions.width - 26, sticky.x * dimensions.width - 13))}px`, top: `${Math.max(0, Math.min(dimensions.height - 26, sticky.y * dimensions.height - 13))}px` }}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          markerDrag.current = { id: sticky.id, pointerId: event.pointerId, ...markerPosition(event.currentTarget), clientX: event.clientX, clientY: event.clientY, moved: false };
        }}
        onPointerMove={moveMarker}
        onPointerUp={stopMarker}
        onPointerCancel={(event) => { markerDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const marker = markerPosition(event.currentTarget);
          changeSticky(sticky.id, {
            x: boundMarker(marker.x + (event.key === 'ArrowLeft' ? -.01 : event.key === 'ArrowRight' ? .01 : 0), marker.minX),
            y: boundMarker(marker.y + (event.key === 'ArrowUp' ? -.01 : event.key === 'ArrowDown' ? .01 : 0), marker.minY),
          }, true);
        }}
        onClick={() => openMarker(sticky)}
      ><FireflyOutline /></button>;
      return <div
      key={sticky.id}
      data-sticky-id={sticky.id}
      className="source-sticky"
      style={{ left: `${Math.min(sticky.x * dimensions.width, Math.max(0, dimensions.width - Math.min(190, dimensions.width - 12)))}px`, top: `${Math.min(sticky.y * dimensions.height, Math.max(0, dimensions.height - 143))}px` }}
    >
      <div className="source-sticky-head" role="group" tabIndex={0} aria-label="移动便利贴" title="拖动移动便利贴；方向键微调" onPointerDown={(event) => {
        if (event.target.closest('button')) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const pageRect = root.current.getBoundingClientRect();
        dragging.current = { id: sticky.id, pointerId: event.pointerId, x: sticky.x, y: sticky.y, clientX: event.clientX, clientY: event.clientY, width: pageRect.width, height: pageRect.height };
      }} onPointerMove={moveSticky} onPointerUp={stopSticky} onPointerCancel={stopSticky} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        changeSticky(sticky.id, { x: clamp(sticky.x + (event.key === 'ArrowLeft' ? -.01 : event.key === 'ArrowRight' ? .01 : 0)), y: clamp(sticky.y + (event.key === 'ArrowUp' ? -.01 : event.key === 'ArrowDown' ? .01 : 0)) });
      }}>
        <span>便利贴</span>
        <div className="source-sticky-actions">
          <button type="button" title="隐藏便利贴" aria-label="隐藏便利贴" onClick={() => { changeSticky(sticky.id, { collapsed: true }, true); setOpenedStickyId(null); }}><EyeOff size={15} /></button>
          <button type="button" title="删除便利贴" aria-label="删除便利贴" onClick={() => commit({ ...markup.current, stickies: markup.current.stickies.filter((item) => item.id !== sticky.id) }, true)}><Trash2 size={14} /></button>
        </div>
      </div>
      <textarea aria-label="便利贴内容" placeholder="写下这页的想法…" maxLength={2000} value={sticky.text} onChange={(event) => changeSticky(sticky.id, { text: event.target.value })} onBlur={() => commit(markup.current, true)} />
    </div>;
    })}
  </div>;
}
