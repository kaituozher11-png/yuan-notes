import { useId } from 'react';
import { edgeLabelPosition, edgePath, nodeFontSize, nodeSize, nodeTextLines, wrapMapText } from './mindMapModel';

export const mapColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
export function MapNodeShape({ node }) {
  const { width, height } = nodeSize(node);
  const attrs = { fill: mapColor(node.fill, '#ffffff'), stroke: mapColor(node.color, '#83aaa9'), strokeWidth: 2 };
  if (node.shape === 'circle') return <circle cx={width / 2} cy={height / 2} r={width / 2 - 1} {...attrs}/>;
  if (node.shape === 'ellipse') return <ellipse cx={width / 2} cy={height / 2} rx={width / 2 - 1} ry={height / 2 - 1} {...attrs}/>;
  if (node.shape === 'diamond') return <polygon points={`${width / 2},1 ${width - 1},${height / 2} ${width / 2},${height - 1} 1,${height / 2}`} {...attrs}/>;
  return <rect width={width} height={height} rx={6} {...attrs}/>;
}

export function MapElements({ nodes, edges, selected = [], selectedEdge, search = '', onNodeDown, onNodeDoubleClick, onNodeKey, onEdge, onFold, interactive = false }) {
  const marker = 'map-arrow-' + useId().replace(/:/g, '');
  const lookup = new Map(nodes.map(node => [node.id, node]));
  return <>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>
    {edges.map(edge => {
      const from = lookup.get(edge.from), to = lookup.get(edge.to);
      if (!from || !to) return null;
      const path = edgePath(from, { ...to, style: edge.style }), label = edgeLabelPosition(from, to);
      const lines = wrapMapText(edge.text || '', 200, 13), h = lines.length * 17 + 10;
      return <g key={edge.id} className={`mindmap-edge ${selectedEdge === edge.id ? 'selected' : ''}`} {...(interactive ? { role: 'button', tabIndex: 0, 'aria-label': `连接线：${from.text} 到 ${to.text}${edge.text ? `，${edge.text}` : ''}`, onClick: event => { event.stopPropagation(); onEdge?.(edge.id); }, onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdge?.(edge.id); } } } : {})}>
        <path d={path} stroke={mapColor(edge.color, '#618e90')} strokeWidth={edge.width || 2} strokeDasharray={edge.dashed ? '8 5' : undefined} markerEnd={edge.arrow ? `url(#${marker})` : undefined} fill="none"/>
        {interactive && <path d={path} stroke="transparent" strokeWidth="18" fill="none"/>}
        {edge.text && <g transform={`translate(${label.x} ${label.y})`} pointerEvents="none"><rect x="-108" y={-h / 2} width="216" height={h} rx="4" fill="white" stroke="#d0e1df"/><text textAnchor="middle" fill="#36595d" fontSize="13" fontFamily="Segoe UI,Microsoft YaHei,sans-serif">{lines.map((line, i) => <tspan key={i} x="0" y={(i - (lines.length - 1) / 2) * 17 + 4}>{line}</tspan>)}</text></g>}
      </g>;
    })}
    {nodes.map(node => {
      const { width, height } = nodeSize(node), lines = nodeTextLines(node), font = nodeFontSize(node);
      const highlighted = selected.includes(node.id), matched = search && node.text?.toLocaleLowerCase().includes(search.toLocaleLowerCase());
      const hasEdges = edges.some(edge => edge.from === node.id);
      return <g key={node.id} transform={`translate(${node.x} ${node.y})`} className="mindmap-node" {...(interactive ? { role: 'button', tabIndex: 0, 'aria-label': `节点：${node.text || '未命名'}`, 'aria-pressed': highlighted, onPointerDown: event => onNodeDown?.(event, node), onDoubleClick: () => onNodeDoubleClick?.(node), onKeyDown: event => onNodeKey?.(event, node) } : {})}>
        {(highlighted || matched) && <rect x="-5" y="-5" width={width + 10} height={height + 10} rx="8" fill="none" stroke={highlighted ? '#176d72' : '#e6a334'} strokeWidth="3" strokeDasharray={matched && !highlighted ? '6 3' : undefined}/>}
        <MapNodeShape node={node}/>
        <text textAnchor="middle" fill={mapColor(node.textColor, '#254c50')} fontSize={font} fontWeight={node.bold ? 700 : 400} fontFamily="Segoe UI,Microsoft YaHei,sans-serif" pointerEvents="none">{lines.map((line, index) => <tspan key={index} x={width / 2} y={height / 2 + (index - (lines.length - 1) / 2) * font * 1.35 + font * .34}>{line}</tspan>)}</text>
        {interactive && (hasEdges || node.collapsed) && <g role="button" tabIndex={0} aria-label={`${node.collapsed ? '展开' : '折叠'}分支：${node.text}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onFold?.(node); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); event.preventDefault(); onFold?.(node); } }}><circle cx={width + 14} cy={height / 2} r="11" fill="#fff" stroke="#79aaa8"/><text x={width + 14} y={height / 2 + 5} textAnchor="middle" fontSize="17" fill="#23686b">{node.collapsed ? '+' : '−'}</text></g>}
      </g>;
    })}
  </>;
}
