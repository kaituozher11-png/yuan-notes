import { useRef } from 'react';
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import { imageWidth } from './imageLayout';

export default function NoteImage({ block, onChange, label = '图片说明', showCaption = true }) {
  const drag = useRef(null);
  const width = imageWidth(block.width);
  const align = ['left', 'center', 'right'].includes(block.align) ? block.align : 'center';
  return <div className="image-block">
    <div className="image-controls">
      <label>大小 <input type="range" min="20" max="100" step="1" value={width} aria-label="图片大小" onChange={(event) => onChange({ width: Number(event.target.value) })}/><span>{width}%</span></label>
      <div className="image-align" role="group" aria-label="图片位置">
        {[[AlignLeft, 'left', '左对齐'], [AlignCenter, 'center', '居中'], [AlignRight, 'right', '右对齐']].map(([Icon, value, title]) =>
          <button type="button" key={value} className={align === value ? 'active' : ''} title={title} aria-label={title} aria-pressed={align === value} onClick={() => onChange({ align: value })}><Icon size={16}/></button>)}
      </div>
    </div>
    <div className={`note-image-track align-${align}`}>
      <div className="note-image-frame" style={{ width: `${width}%` }}>
        <img src={block.data} alt={block.text || '笔记图片'} />
        <button type="button" className="image-resize-handle" aria-label="拖动调整图片大小" title="拖动调整图片大小"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { pointerId: event.pointerId, start: event.clientX, width, container: event.currentTarget.closest('.note-image-track').getBoundingClientRect().width, factor: align === 'right' ? -1 : align === 'center' ? 2 : 1 };
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return;
            onChange({ width: imageWidth(drag.current.width + (event.clientX - drag.current.start) / drag.current.container * 100 * drag.current.factor) });
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }} />
      </div>
    </div>
    {showCaption && <input aria-label={label} value={block.text || ''} onChange={(event) => onChange({ text: event.target.value })} />}
  </div>;
}
