import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { FormulaEntry, MathDisplay } from './FormulaDisplay';
import { DRAWING_WIDTH, drawingHeight } from './drawingSize';
import { edgeLabelPosition, edgePath, MAP_WIDTH, MAP_HEIGHT, nodeSize, normalizeMap } from './mindMapModel';
import { imageWidth } from './imageLayout';
import { freeNoteBlocks } from './richDocument';
import katex from 'katex';
import { aiNoteSections } from './aiNoteOutline';

const Markdown = ({ children }) => <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{String(children || '')}</ReactMarkdown>;

function DrawingPrint({ strokes = [], height }) {
  const actualHeight = drawingHeight(height);
  return <svg viewBox={`0 0 ${DRAWING_WIDTH} ${actualHeight}`} className="drawing-print" aria-label="手写笔记"><rect width={DRAWING_WIDTH} height={actualHeight} fill="white"/>{strokes.map((stroke, index) => <polyline key={index} points={stroke.points.map((p) => p.join(',')).join(' ')} fill="none" stroke={stroke.tool === 'eraser' ? 'white' : stroke.color} strokeWidth={stroke.size} opacity={stroke.tool === 'highlighter' ? .35 : 1} strokeLinecap="round" strokeLinejoin="round"/>)}</svg>;
}
function MindMapPrint({ nodes = [], edges }) {
  const map = normalizeMap({ nodes, edges });
  return <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} className="mindmap-print" aria-label="思维导图"><rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="white"/>
    {map.edges.map((edge) => { const from = nodes.find((n) => n.id === edge.from); const to = nodes.find((n) => n.id === edge.to); if (!from || !to) return null; const label = edgeLabelPosition(from, to); return <g key={edge.id}><path d={edgePath(from, { ...to, style: edge.style })} stroke={edge.color || '#618e90'} strokeWidth={edge.width || 2} fill="none"/>{edge.text && <text x={label.x} y={label.y} textAnchor="middle" fill="#36595d" fontSize="13">{edge.text}</text>}</g>; })}
    {nodes.map((n) => { const { width, height } = nodeSize(n); return <g key={n.id} transform={`translate(${n.x} ${n.y})`} fill="#e9f3f2" stroke="#8dbfbd">
      {n.shape === 'circle' ? <circle cx={width/2} cy={height/2} r={width/2-2}/> : n.shape === 'ellipse' ? <ellipse cx={width/2} cy={height/2} rx={width/2-2} ry={height/2-2}/> : n.shape === 'diamond' ? <polygon points={`${width/2},2 ${width-2},${height/2} ${width/2},${height-2} 2,${height/2}`}/> : <rect width={width} height={height} rx="5"/>}
      <text x={width/2} y={height/2+5} textAnchor="middle" fill="#254c50" stroke="none" fontSize="16">{n.text?.slice(0, 12)}</text>
    </g>; })}
  </svg>;
}
function RichPrintNode({ node }) {
  const children = (node.content || []).map((child, index) => <RichPrintNode node={child} key={index}/>);
  if (node.type === 'doc') return <>{children}</>;
  if (node.type === 'paragraph') return <p>{children.length ? children : <br/>}</p>;
  if (node.type === 'heading') return node.attrs?.level === 3 ? <h3>{children}</h3> : <h2>{children}</h2>;
  if (node.type === 'bulletList') return <ul>{children}</ul>;
  if (node.type === 'orderedList') return <ol>{children}</ol>;
  if (node.type === 'listItem') return <li>{children}</li>;
  if (node.type === 'hardBreak') return <br/>;
  if (node.type === 'formulaInline') {
    try { return <span className="rich-print-formula" dangerouslySetInnerHTML={{ __html: katex.renderToString(node.attrs?.latex || '', { displayMode: false, trust: false, output: 'mathml' }) }}/>; }
    catch { return <span>{node.attrs?.latex || '公式'}</span>; }
  }
  if (node.type === 'noteImage') {
    const align = node.attrs?.align || 'left';
    return <img src={node.attrs?.src} alt={node.attrs?.alt || '笔记图片'} style={{
      display: 'block', float: align === 'center' ? 'none' : align,
      width: `${imageWidth(node.attrs?.width)}%`, maxWidth: '100%', height: 'auto',
      margin: align === 'center' ? '8px auto 12px' : align === 'right' ? '3px 0 10px 12px' : '3px 12px 10px 0',
    }}/>
  }
  if (node.type === 'noteDrawing') return <PrintBlock block={{ type: 'drawing', ...node.attrs }}/>;
  if (node.type === 'noteMindMap') return <PrintBlock block={{ type: 'mindmap', ...node.attrs }}/>;
  if (node.type === 'text') return (node.marks || []).reduce((content, mark) => {
    if (mark.type === 'bold') return <strong>{content}</strong>;
    if (mark.type === 'italic') return <em>{content}</em>;
    if (mark.type === 'strike') return <s>{content}</s>;
    if (mark.type === 'code') return <code>{content}</code>;
    return content;
  }, node.text || '');
  return <>{children}</>;
}
function PrintBlock({ block }) {
  if (block.type === 'mixed') return block.rich
    ? <div className="rich-print" style={{ display: 'flow-root' }}><RichPrintNode node={block.rich}/></div>
    : <div className="mixed-print">{(block.parts || []).map((part) => <PrintBlock key={part.id} block={part} />)}</div>;
  if (block.type === 'image') return <figure style={{ width: `${imageWidth(block.width)}%`, marginLeft: block.align === 'left' ? 0 : 'auto', marginRight: block.align === 'right' ? 0 : 'auto' }}><img src={block.data} alt={block.text || '笔记图片'}/><figcaption>{block.text}</figcaption></figure>;
  if (block.type === 'drawing') return <figure><DrawingPrint strokes={block.strokes} height={block.height}/></figure>;
  if (block.type === 'mindmap') return <figure><MindMapPrint nodes={block.nodes} edges={block.edges}/></figure>;
  if (block.type === 'formula') return <div className="formula-print"><MathDisplay latex={block.text} output="mathml" /></div>;
  return <div className="text-print"><Markdown>{block.text}</Markdown></div>;
}
function PrintDocument({ doc, notes }) {
  const pages = Array.from({ length: doc.pages }, (_, i) => ({ page: i + 1, notes: notes.filter((n) => !n.deleted && n.page === i + 1) })).filter((x) => x.notes.length);
  return <main>
    <header><h1>{doc.name}</h1><p>{doc.course || '未分类'} · {doc.filename} · 共 {doc.pages} 页</p></header>
    {pages.length ? pages.map(({ page, notes: pageNotes }) => <section className="source-page" key={page}>
      <h2>原文第 {page} 页</h2>
      {pageNotes.map((note) => <article key={note.id}>
        <div className="note-kind">{note.kind === 'ai' ? '智能笔记' : '我的笔记'}</div><h3>{note.title}</h3>
        {note.ai && <div className="ai-print">{aiNoteSections(note.ai).map(({ key, title, value, kind }) => <section key={key}><h4>{title}</h4>{kind === 'formula' && Array.isArray(value) ? value.map((item, i) => <FormulaEntry value={item} output="mathml" key={i} />) : Array.isArray(value) ? <ul>{value.map((item, i) => <li key={i}><Markdown>{item}</Markdown></li>)}</ul> : <Markdown>{value}</Markdown>}</section>)}</div>}
        {note.kind === 'user' && note.blocks?.length
          ? freeNoteBlocks(note.blocks).map((block) => <PrintBlock key={block.id} block={block}/>)
          : note.blocks?.map((block) => <PrintBlock key={block.id} block={block} />)}
        {note.links?.map((link) => <section className="links-print" key={link.id}>
          <h4>关联原文 · 第 {link.page} 页</h4>
          <p>{link.quote ? <q>{link.quote}</q> : link.label || (link.rect ? '框选区域' : '整页')}</p>
          {link.annotations?.map((item) => <PrintBlock key={item.id} block={item} />)}
        </section>)}
      </article>)}
    </section>) : <p>这份资料还没有笔记。</p>}
  </main>;
}

export async function exportDocument(doc, notes) {
  async function embedSource(src) {
    if (!src?.startsWith('/api/images/')) return src;
    const response = await fetch(src);
    if (!response.ok) throw new Error('笔记图片无法读取');
    const blob = await response.blob();
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
  }
  async function embedImage(item) {
    if (item.type !== 'image' || !item.data?.startsWith('/api/images/')) return item;
    return { ...item, data: await embedSource(item.data) };
  }
  async function embedRich(node) {
    if (!node) return node;
    return {
      ...node,
      ...(node.type === 'noteImage' ? { attrs: { ...node.attrs, src: await embedSource(node.attrs?.src) } } : {}),
      ...(node.content ? { content: await Promise.all(node.content.map(embedRich)) } : {}),
    };
  }
  const selected = await Promise.all(notes.filter((n) => n.docId === doc.id).map(async (note) => ({
    ...note,
    blocks: await Promise.all((note.blocks || []).map(async (block) => block.type === 'mixed'
      ? { ...block, parts: await Promise.all((block.parts || []).map(embedImage)), ...(block.rich ? { rich: await embedRich(block.rich) } : {}) }
      : embedImage(block))),
    links: await Promise.all((note.links || []).map(async (link) => ({ ...link, annotations: await Promise.all((link.annotations || []).map(embedImage)) }))),
  })));
  const markup = renderToStaticMarkup(<PrintDocument doc={doc} notes={selected}/>);
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${doc.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</title><style>body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#263a3d;line-height:1.65;max-width:850px;margin:0 auto;padding:30px}header{border-bottom:2px solid #247c80;padding-bottom:10px;margin-bottom:26px}h1{font-size:28px;margin-bottom:4px}h2{font-size:20px;margin-top:30px;color:#1b676b}h3{font-size:17px;margin:5px 0}h4{font-size:13px;margin:14px 0 4px;color:#3c7072}p{margin:5px 0 10px}article{border-bottom:1px solid #dce9e9;padding:16px 0 20px;break-inside:avoid}.note-kind{font-size:11px;color:#61878a}ul{padding-left:22px}.ai-print{border-left:3px solid #d79b62;padding-left:15px}.rich-print{margin:12px 0;min-width:0}.rich-print p{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all}.rich-print figure{max-width:100%}.rich-print figure img{width:100%;height:auto}.rich-print-formula{display:inline-block;vertical-align:middle}.mixed-print{margin:12px 0}.mixed-print>*{margin:9px 0}figure{margin:16px 0}figure img{display:block;max-width:100%;max-height:600px}figcaption,.links-print{font-size:12px;color:#637a7d}.drawing-print,.mindmap-print{display:block;width:100%;border:1px solid #e1eaea}.formula-print{padding:8px;background:#f5f8f8;overflow:auto}.katex-html{display:none}.katex-mathml{display:inline}@media print{body{max-width:none;padding:0}.source-page{break-before:page}.source-page:first-of-type{break-before:auto}article{break-inside:avoid}}</style></head><body>${markup}</body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  if (window.YingxingAndroidDownload?.save) {
    const reader = new FileReader();
    reader.onload = () => window.YingxingAndroidDownload.save(`${doc.name}-完整笔记.html`, blob.type, String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `${doc.name}-完整笔记.html`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
