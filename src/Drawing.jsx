import { useEffect, useRef, useState } from 'react';
import { Eraser, Highlighter, Pen, Plus, RotateCcw } from 'lucide-react';
import { DRAWING_WIDTH, MAX_DRAWING_HEIGHT, drawingHeight, nextDrawingHeight } from './drawingSize';

export default function Drawing({ value, onChange, height, onHeightChange }) {
  const canvas = useRef(null);
  const expandButton = useRef(null);
  const strokes = useRef(value || []);
  const drawing = useRef(null);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#176d72');
  const [size, setSize] = useState(3);
  const canvasHeight = drawingHeight(height);
  useEffect(() => { strokes.current = value || []; paint(); }, [value, canvasHeight]);
  function paint() {
    const el = canvas.current; if (!el) return;
    const ctx = el.getContext('2d');
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, el.width, el.height);
    ctx.strokeStyle = '#e9eef0'; ctx.lineWidth = 1;
    for (let x = 0; x < el.width; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, el.height); ctx.stroke(); }
    for (let y = 0; y < el.height; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(el.width, y); ctx.stroke(); }
    for (const stroke of [...strokes.current, ...(drawing.current ? [drawing.current] : [])]) {
      if (!stroke.points.length) continue;
      ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1;
      ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(stroke.points[0][0], stroke.points[0][1]);
      for (const [x, y] of stroke.points.slice(1)) ctx.lineTo(x, y);
      ctx.lineTo(stroke.points.at(-1)[0] + .01, stroke.points.at(-1)[1] + .01); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function point(event) { const box = canvas.current.getBoundingClientRect(); return [(event.clientX - box.left) * canvas.current.width / box.width, (event.clientY - box.top) * canvas.current.height / box.height]; }
  function down(event) { event.preventDefault(); canvas.current.setPointerCapture(event.pointerId); drawing.current = { tool, color, size: tool === 'eraser' ? 24 : tool === 'highlighter' ? 16 : size, points: [point(event)] }; paint(); }
  function move(event) { if (!drawing.current) return; drawing.current.points.push(point(event)); paint(); }
  function up() { if (!drawing.current) return; strokes.current = [...strokes.current, drawing.current]; drawing.current = null; onChange(strokes.current); paint(); }
  return <div className="drawing"><div className="drawing-tools"><button className={tool === 'pen' ? 'active' : ''} title="画笔" onClick={() => setTool('pen')}><Pen size={17}/></button><button className={tool === 'highlighter' ? 'active' : ''} title="荧光笔" onClick={() => setTool('highlighter')}><Highlighter size={17}/></button><button className={tool === 'eraser' ? 'active' : ''} title="橡皮" onClick={() => setTool('eraser')}><Eraser size={17}/></button><input aria-label="笔迹颜色" type="color" value={color} onChange={(e) => setColor(e.target.value)}/><input aria-label="笔迹粗细" type="range" min="1" max="10" value={size} onChange={(e) => setSize(Number(e.target.value))}/><button title="撤销上一笔" onClick={() => { strokes.current = strokes.current.slice(0, -1); onChange(strokes.current); paint(); }}><RotateCcw size={17}/></button></div><canvas ref={canvas} width={DRAWING_WIDTH} height={canvasHeight} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} /><button ref={expandButton} type="button" className="drawing-expand" title="增加手写区域" aria-label="增加手写区域" disabled={canvasHeight >= MAX_DRAWING_HEIGHT} onClick={() => { onHeightChange(nextDrawingHeight(canvasHeight)); requestAnimationFrame(() => expandButton.current?.scrollIntoView({ block: 'nearest' })); }}><Plus size={18}/></button></div>;
}
