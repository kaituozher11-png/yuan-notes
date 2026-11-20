import { useEffect, useRef, useState } from 'react';
import { Copy, MessageSquareText } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { buildSourcePage } from './sourceLayout';
import { moveRegionRect, resizeRegionRect } from './regionRect';
import { nearestTextRun, selectionColumnBounds, selectVisibleText } from './pdfTextSelection';
import SourceMarkup from './SourceMarkup';
import { offlinePdf } from './offlineStore';
import { pdfDocumentOptions } from './pdfAssets';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const handles = { nw: '左上角', n: '上边', ne: '右上角', e: '右边', se: '右下角', s: '下边', sw: '左下角', w: '左边' };

export default function PdfPage({ docId, page, zoom, onText, onTextSelection, selectedQuote, regionMode, onRegion, selectedRect, onSelectedRectChange, highlightRect, links = [], onAnnotationHover, onAnnotationLeave, onAnnotationClick, markup, onMarkupChange, markupTool, markupColor, markupSize, showStickies, onStickyPlaced, onCopyResult }) {
  const canvas = useRef(null);
  const layer = useRef(null);
  const area = useRef(null);
  const editing = useRef(null);
  const textDrag = useRef(null);
  const selectedText = useRef('');
  const [status, setStatus] = useState('正在打开原文…');
  const [available, setAvailable] = useState(0);
  const [displayScale, setDisplayScale] = useState(1);
  const [drag, setDrag] = useState(null);
  const [rect, setRect] = useState(null);
  const [textRects, setTextRects] = useState([]);
  const [copyAnchor, setCopyAnchor] = useState(null);
  useEffect(() => { if (!selectedQuote) { selectedText.current = ''; setTextRects([]); setCopyAnchor(null); } }, [selectedQuote]);
  useEffect(() => {
    const container = canvas.current?.closest('.source-scroll');
    if (!container) return;
    let timer;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setAvailable(Math.max(240, container.clientWidth - 44)), 120);
    });
    observer.observe(container);
    setAvailable(Math.max(240, container.clientWidth - 44));
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);
  useEffect(() => {
    if (!available) return;
    let active = true; let task;
    textDrag.current = null;
    selectedText.current = '';
    setTextRects([]);
    setCopyAnchor(null);
    let loading;
    setStatus('正在打开原文…');
    (async () => {
      const source = window.YuanOfflineApp ? { data: await offlinePdf(docId), ...pdfDocumentOptions } : { url: `/api/docs/${docId}/pdf`, ...pdfDocumentOptions };
      if (!active) return;
      loading = pdfjs.getDocument(source);
      return loading.promise;
    })().then(async (pdf) => {
      if (!pdf) return;
      const source = await pdf.getPage(page);
      const base = source.getViewport({ scale: 1 });
      const viewport = source.getViewport({ scale: zoom * Math.min(1, available / base.width) });
      setDisplayScale(viewport.scale);
      if (!active || !canvas.current) return;
      const el = canvas.current;
      el.width = Math.floor(viewport.width * devicePixelRatio);
      el.height = Math.floor(viewport.height * devicePixelRatio);
      el.style.width = `${viewport.width}px`;
      el.style.height = `${viewport.height}px`;
      const context = el.getContext('2d');
      task = source.render({ canvasContext: context, viewport, transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0], canvas: el });
      await task.promise;
      if (active) setStatus('');
      const content = await source.getTextContent();
      if (!active || !layer.current) return;
      layer.current.replaceChildren();
      const textLayer = new pdfjs.TextLayer({ textContentSource: content, container: layer.current, viewport });
      await textLayer.render();
      if (active) onText(buildSourcePage(content.items, base.width, base.height));
    }).catch((error) => { if (active && error.name !== 'RenderingCancelledException') setStatus('原文预览失败，请检查文档'); });
    return () => { active = false; task?.cancel(); loading?.destroy(); };
  }, [docId, page, zoom, available]);
  function coordinate(event) { const box = area.current.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) }; }
  function textPosition(x, y, bounds, runs) {
    const nearest = nearestTextRun(runs, x, y, bounds);
    if (!nearest) return null;
    const { id, rect } = nearest.run;
    const caret = document.caretRangeFromPoint(Math.max(rect.left + .5, Math.min(x, rect.right - .5)), rect.top + rect.height / 2);
    return {
      id,
      offset: caret && id.contains(caret.startContainer)
        ? caret.startOffset : x < (rect.left + rect.right) / 2 ? 0 : id.firstChild.length,
      dx: nearest.dx,
      dy: nearest.dy,
    };
  }
  function textDown(event) {
    if (!['mouse', 'pen'].includes(event.pointerType) || event.button !== 0) return;
    const pageRect = layer.current.getBoundingClientRect();
    const full = { left: pageRect.left, right: pageRect.right };
    const runs = [...layer.current.querySelectorAll('span')].filter((span) => span.firstChild?.nodeType === Node.TEXT_NODE).map((span) => ({
      id: span, text: span.textContent, rect: span.getBoundingClientRect(),
    }));
    const anchor = textPosition(event.clientX, event.clientY, full, runs);
    if (!anchor || anchor.dx > 20 || anchor.dy > 12) return;
    const bounds = selectionColumnBounds(pageRect, anchor.id.getBoundingClientRect(), runs);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    window.getSelection()?.removeAllRanges();
    selectedText.current = '';
    setTextRects([]);
    setCopyAnchor(null);
    textDrag.current = { anchor, bounds, runs, selection: null };
  }
  function textMove(event) {
    if (!textDrag.current) return;
    const { anchor, bounds, runs } = textDrag.current;
    const x = Math.max(bounds.left + 1, Math.min(event.clientX, bounds.right - 1));
    const position = textPosition(x, event.clientY, bounds, runs);
    if (!position) return;
    const result = selectVisibleText(runs, anchor, position, bounds);
    const pageRect = layer.current.getBoundingClientRect();
    const rects = result.segments.map((segment) => {
      const range = document.createRange();
      range.setStart(segment.id.firstChild, segment.start);
      range.setEnd(segment.id.firstChild, segment.end);
      return range.getBoundingClientRect();
    }).filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => ({
      x: Math.max(0, (rect.left - pageRect.left) / pageRect.width),
      y: Math.max(0, (rect.top - pageRect.top) / pageRect.height),
      width: Math.min(1, (rect.right - pageRect.left) / pageRect.width) - Math.max(0, (rect.left - pageRect.left) / pageRect.width),
      height: Math.min(1, (rect.bottom - pageRect.top) / pageRect.height) - Math.max(0, (rect.top - pageRect.top) / pageRect.height),
    })).filter((rect) => rect.width > 0 && rect.height > 0);
    textDrag.current.selection = { quote: result.text, rects };
    selectedText.current = result.text;
    setTextRects(rects);
  }
  function textUp(event) {
    if (!textDrag.current) return;
    textMove(event);
    const selection = textDrag.current.selection;
    textDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onTextSelection?.(selection);
    if (selection?.quote) {
      const pageRect = layer.current.getBoundingClientRect();
      setCopyAnchor({
        x: Math.max(4, Math.min(pageRect.width - 82, event.clientX - pageRect.left)),
        y: Math.max(4, Math.min(pageRect.height - 36, event.clientY - pageRect.top - 38)),
      });
    } else setCopyAnchor(null);
  }
  function textCancel(event) {
    textDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    selectedText.current = '';
    setTextRects([]);
    setCopyAnchor(null);
  }
  async function copySelectedText() {
    const text = selectedText.current;
    if (!text) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      onCopyResult?.(true);
    } catch {
      const input = document.createElement('textarea');
      input.value = text;
      input.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(input);
      let copied = false;
      try {
        input.select();
        copied = document.execCommand('copy');
      } catch { /* Clipboard access can be disabled by the browser. */ }
      finally {
        input.remove();
        layer.current?.focus({ preventScroll: true });
      }
      onCopyResult?.(copied);
    }
  }
  function down(event) { if (!regionMode) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const p = coordinate(event); setDrag(p); setRect({ x: p.x, y: p.y, width: 0, height: 0 }); }
  function move(event) { if (!drag) return; const p = coordinate(event); setRect({ x: Math.min(p.x, drag.x), y: Math.min(p.y, drag.y), width: Math.abs(p.x - drag.x), height: Math.abs(p.y - drag.y) }); }
  function up(event) { if (!drag) return; const p = coordinate(event); const next = { x: Math.min(p.x, drag.x), y: Math.min(p.y, drag.y), width: Math.abs(p.x - drag.x), height: Math.abs(p.y - drag.y) }; setDrag(null); setRect(null); if (next.width > .015 && next.height > .015) onRegion(next); }
  function selectionDown(event) {
    if (!selectedRect || regionMode || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    editing.current = { start: coordinate(event), rect: selectedRect, handle: event.target.closest('[data-handle]')?.dataset.handle };
  }
  function selectionMove(event) {
    if (!editing.current) return;
    const point = coordinate(event);
    const { start, rect: initial, handle } = editing.current;
    onSelectedRectChange(handle ? resizeRegionRect(initial, handle, point) : moveRegionRect(initial, point.x - start.x, point.y - start.y));
  }
  function selectionUp(event) {
    editing.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function selectionKeyDown(event) {
    if (!selectedRect || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const step = event.altKey ? .001 : .01;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (event.shiftKey) {
      const handle = dx ? 'e' : 's';
      onSelectedRectChange(resizeRegionRect(selectedRect, handle, { x: selectedRect.x + selectedRect.width + dx, y: selectedRect.y + selectedRect.height + dy }));
    } else onSelectedRectChange(moveRegionRect(selectedRect, dx, dy));
  }
  function hover(event) {
    if (regionMode || selectedRect) return;
    if (event.target.closest('.pdf-annotation-marker')) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    const link = links.find((item) => (item.rects?.length ? item.rects : item.rect ? [item.rect] : []).some((region) => x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height));
    if (link) onAnnotationHover(link, event);
    else onAnnotationLeave();
  }
  const box = rect || selectedRect || highlightRect;
  return <div className="pdf-canvas-wrap" style={{ '--total-scale-factor': displayScale }} onMouseMove={hover} onMouseLeave={onAnnotationLeave}>
    {status && <div className="pdf-status">{status}</div>}
    <canvas ref={canvas} aria-label={`原文第 ${page} 页`} />
    <div ref={layer} className="pdf-text-layer textLayer" tabIndex={0} onPointerDown={textDown} onPointerMove={textMove} onPointerUp={textUp} onPointerCancel={textCancel} onCopy={(event) => { if (selectedText.current) { event.clipboardData.setData('text/plain', selectedText.current); event.preventDefault(); onCopyResult?.(true); } }} />
    <div className="pdf-text-selection">{textRects.map((region, index) => <div key={index} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />)}</div>
    {copyAnchor && selectedText.current && <button type="button" className="pdf-copy-selection" style={{ left: copyAnchor.x, top: copyAnchor.y }} onMouseDown={(event) => event.preventDefault()} onClick={copySelectedText} title="复制选中的原文文字"><Copy size={14} />复制</button>}
    <div className="pdf-annotation-markers">{links.map((link) => {
      const regions = link.rects?.length ? link.rects : link.rect ? [link.rect] : [];
      if (!regions.length) return null;
      const first = regions[0];
      return <div key={link.id}>
        {regions.map((region, index) => <div key={index} className="pdf-annotation-highlight" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />)}
        <button className="pdf-annotation-marker" style={{ left: `${first.x * 100}%`, top: `${first.y * 100}%` }} aria-label={`查看 ${link.note.title} 的原文批注`} title="查看原文批注" onMouseEnter={(event) => onAnnotationHover(link, event)} onMouseLeave={onAnnotationLeave} onFocus={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); onAnnotationHover(link, { clientX: bounds.left, clientY: bounds.bottom }); }} onBlur={onAnnotationLeave} onClick={() => onAnnotationClick(link)}><MessageSquareText size={12} /></button>
      </div>;
    })}</div>
    <div ref={area} className={`pdf-region-layer ${regionMode ? 'active' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { setDrag(null); setRect(null); }}>
      {box && selectedRect && !regionMode && !rect ? <div
        className="pdf-region-selection"
        role="group"
        tabIndex={0}
        aria-label="框选区域"
        title="拖动调整框选位置"
        style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
        onPointerDown={selectionDown}
        onPointerMove={selectionMove}
        onPointerUp={selectionUp}
        onPointerCancel={selectionUp}
        onKeyDown={selectionKeyDown}
      >{Object.entries(handles).map(([handle, label]) => <span key={handle} className={`pdf-region-handle handle-${handle}`} data-handle={handle} title={`调整${label}`} />)}</div>
        : box && <div className="pdf-region-highlight" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }} />}
    </div>
    <SourceMarkup key={`${docId}:${page}`} value={markup} onChange={onMarkupChange} tool={markupTool} color={markupColor} size={markupSize} showStickies={showStickies} onStickyPlaced={onStickyPlaced} />
  </div>;
}
