import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import { Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { AlignCenter, AlignLeft, AlignRight, Bold, ImagePlus, Italic, List, ListTree, PenLine, Sigma, Trash2, Type, X } from 'lucide-react';
import katex from 'katex';
import Drawing from './Drawing';
import { blockToRich } from './richDocument';
import { imageWidth } from './imageLayout';
import { pastedImage, uploadNoteImage } from './noteImages';
import './richNote.css';

const FormulaEditor = lazy(() => import('./FormulaEditor'));
function embeddedAttrs(element, name) {
  try { return JSON.parse(element.getAttribute(name) || '{}'); }
  catch { return {}; }
}

function FormulaView({ node }) {
  const latex = node.attrs.latex || '';
  let html;
  try { html = katex.renderToString(latex || '\\square', { displayMode: false, throwOnError: true, trust: false }); }
  catch { html = null; }
  return <NodeViewWrapper as="span" className="rich-formula" contentEditable={false} data-formula-id={node.attrs.id} title="选中公式进行编辑">
    {html ? <span dangerouslySetInnerHTML={{ __html: html }}/> : <span>{latex}</span>}
  </NodeViewWrapper>;
}

function DrawingView({ node, updateAttributes }) {
  return <NodeViewWrapper className="rich-embedded-tool" contentEditable={false}>
    <Drawing value={node.attrs.strokes} height={node.attrs.height} onChange={(strokes) => updateAttributes({ strokes })} onHeightChange={(height) => updateAttributes({ height })}/>
  </NodeViewWrapper>;
}

const FormulaNode = Node.create({
  name: 'formulaInline', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return {
    id: { default: null, parseHTML: (element) => element.getAttribute('data-id') },
    latex: { default: '', parseHTML: (element) => element.getAttribute('data-latex') || '' },
  }; },
  parseHTML() { return [{ tag: 'span[data-rich-formula]' }]; },
  renderHTML({ node }) { return ['span', { 'data-rich-formula': '', 'data-id': node.attrs.id, 'data-latex': node.attrs.latex }]; },
  addNodeView() { return ReactNodeViewRenderer(FormulaView); },
});
const ImageNode = Node.create({
  name: 'noteImage', group: 'inline', inline: true, atom: true, selectable: true, draggable: true,
  addAttributes() { return {
    src: { default: '', parseHTML: (element) => element.getAttribute('src') || '' },
    alt: { default: '', parseHTML: (element) => element.getAttribute('alt') || '' },
    width: { default: 100, parseHTML: (element) => Number(element.getAttribute('data-width')) || 100 },
    align: { default: 'left', parseHTML: (element) => element.getAttribute('data-align') || 'left' },
  }; },
  parseHTML() { return [{ tag: 'img[data-rich-note-image]' }]; },
  renderHTML({ node }) {
    const width = Math.round(imageWidth(node.attrs.width));
    const align = ['left', 'center', 'right'].includes(node.attrs.align) ? node.attrs.align : 'left';
    return ['img', { 'data-rich-note-image': '', src: node.attrs.src, alt: node.attrs.alt, 'data-width': width, 'data-align': align, style: `width:${width}%` }];
  },
});
const DrawingNode = Node.create({
  name: 'noteDrawing', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() { return {
    strokes: { default: [], parseHTML: (element) => embeddedAttrs(element, 'data-rich-drawing').strokes || [] },
    height: { default: null, parseHTML: (element) => embeddedAttrs(element, 'data-rich-drawing').height || null },
  }; },
  parseHTML() { return [{ tag: 'div[data-rich-drawing]' }]; },
  renderHTML({ node }) { return ['div', { 'data-rich-drawing': JSON.stringify(node.attrs) }]; },
  addNodeView() { return ReactNodeViewRenderer(DrawingView); },
});
const extensions = [StarterKit, Placeholder.configure({ placeholder: '在这里输入笔记内容…' }), FormulaNode, ImageNode, DrawingNode];

export default function RichNoteEditor({ block, onChange, onInsertMindMap }) {
  const input = useRef(null);
  const editorRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const uploadPosition = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedFormula, setSelectedFormula] = useState(null);
  onChangeRef.current = onChange;

  function syncSelectedImage(changed) {
    const { selection } = changed.state;
    setSelectedImage(selection.node?.type.name === 'noteImage' ? { pos: selection.from, ...selection.node.attrs } : null);
    setSelectedFormula(selection.node?.type.name === 'formulaInline' ? { pos: selection.from, ...selection.node.attrs } : null);
  }

  async function insertImage(file, at) {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadNoteImage(file);
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) return;
      const position = Math.max(0, Math.min(at ?? editor.state.selection.from, editor.state.doc.content.size));
      editor.chain().focus().insertContentAt(position, { type: 'noteImage', attrs: {
        src: uploaded.url, alt: file.name || '', width: 40, align: 'left',
      } }).run();
    } catch (error) { alert(`图片插入失败：${error.message}`); }
    finally { setUploading(false); }
  }

  const editor = useEditor({
    extensions,
    content: blockToRich(block),
    editorProps: {
      attributes: { class: 'rich-note-surface', 'aria-label': '笔记混合编辑区' },
      handlePaste(view, event) {
        const file = pastedImage(event.clipboardData);
        if (!file) return false;
        insertImage(file, view.state.selection.from);
        return true;
      },
      handleDrop(view, event) {
        const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith('image/'));
        if (!file) return false;
        insertImage(file, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
    onSelectionUpdate({ editor: changed }) { syncSelectedImage(changed); },
    onUpdate({ editor: changed }) { syncSelectedImage(changed); onChangeRef.current(changed.getJSON()); },
  }, [block.id]);
  editorRef.current = editor;
  useEffect(() => {
    if (!editor) return;
    const value = blockToRich(block);
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, block.rich, block.parts]);
  if (!editor) return <div className="rich-note-loading">正在打开笔记编辑区…</div>;

  function insertFormula() {
    const formulaId = crypto.randomUUID();
    editor.chain().focus().insertContent({ type: 'formulaInline', attrs: { id: formulaId, latex: '' } }).run();
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'formulaInline' && node.attrs.id === formulaId) {
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
        return false;
      }
    });
  }
  function insertTool(type) {
    editor.chain().focus().insertContent({ type, attrs: { strokes: [], height: null } }).run();
  }
  function changeFormula(latex) {
    const node = editor.state.doc.nodeAt(selectedFormula?.pos);
    if (node?.type.name !== 'formulaInline') return;
    const transaction = editor.state.tr.setNodeMarkup(selectedFormula.pos, undefined, { ...node.attrs, latex });
    transaction.setSelection(NodeSelection.create(transaction.doc, selectedFormula.pos));
    editor.view.dispatch(transaction);
  }
  function closeFormula() {
    const node = editor.state.doc.nodeAt(selectedFormula?.pos);
    if (node?.type.name === 'formulaInline') editor.chain().focus().setTextSelection(selectedFormula.pos + node.nodeSize).run();
  }
  function changeImage(changes) {
    const node = editor.state.doc.nodeAt(selectedImage?.pos);
    if (node?.type.name !== 'noteImage') return;
    const transaction = editor.state.tr.setNodeMarkup(selectedImage.pos, undefined, { ...node.attrs, ...changes });
    transaction.setSelection(NodeSelection.create(transaction.doc, selectedImage.pos));
    editor.view.dispatch(transaction);
  }
  function deleteImage() {
    const node = editor.state.doc.nodeAt(selectedImage?.pos);
    if (node?.type.name !== 'noteImage') return;
    editor.view.dispatch(editor.state.tr.delete(selectedImage.pos, selectedImage.pos + node.nodeSize));
    editor.commands.focus();
  }
  return <div className="rich-note-editor">
    <div className="rich-note-toolbar" role="toolbar" aria-label="笔记内容工具">
      <button type="button" title="文字" aria-label="文字" onClick={() => editor.chain().focus().setParagraph().run()}><Type size={17}/></button>
      <button type="button" title="加粗" aria-label="加粗" onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={17}/></button>
      <button type="button" title="斜体" aria-label="斜体" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={17}/></button>
      <button type="button" title="项目符号" aria-label="项目符号" onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={17}/></button>
      <span className="rich-toolbar-divider"/>
      <button type="button" title="插入公式" aria-label="插入公式" onClick={insertFormula}><Sigma size={17}/></button>
      <button type="button" title="插入图片" aria-label="插入图片" disabled={uploading} onClick={() => { uploadPosition.current = editor.state.selection.from; input.current?.click(); }}><ImagePlus size={17}/></button>
      <button type="button" title="插入手写" aria-label="插入手写" onClick={() => insertTool('noteDrawing')}><PenLine size={17}/></button>
      <button type="button" title="新增独立思维导图" aria-label="新增独立思维导图" onClick={onInsertMindMap}><ListTree size={17}/></button>
      {uploading && <span className="rich-uploading">图片上传中…</span>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(event) => { insertImage(event.target.files?.[0], uploadPosition.current); event.target.value = ''; }}/>
    </div>
    {selectedFormula && <div className="rich-formula-toolbar" role="region" aria-label="公式编辑工具">
      <div className="rich-formula-toolbar-head"><strong>公式</strong><button type="button" title="完成编辑" aria-label="完成编辑" onClick={closeFormula}><X size={16}/></button></div>
      <Suspense fallback={<div className="formula-loading">正在打开公式编辑器…</div>}>
        <FormulaEditor value={selectedFormula.latex} onChange={changeFormula} label="笔记公式"/>
      </Suspense>
    </div>}
    {selectedImage && <div className="rich-image-toolbar" role="toolbar" aria-label="图片编辑工具">
      <span>图片</span>
      <label>大小 <input type="range" min="20" max="100" step="1" value={Math.round(imageWidth(selectedImage.width))} aria-label="图片大小" onChange={(event) => changeImage({ width: Number(event.target.value) })}/><output>{Math.round(imageWidth(selectedImage.width))}%</output></label>
      <div className="rich-image-align" role="group" aria-label="图片位置">
        {[[AlignLeft, 'left', '左对齐'], [AlignCenter, 'center', '居中'], [AlignRight, 'right', '右对齐']].map(([Icon, value, title]) =>
          <button type="button" key={value} title={title} aria-label={title} aria-pressed={selectedImage.align === value} className={selectedImage.align === value ? 'active' : ''} onClick={() => changeImage({ align: value })}><Icon size={16}/></button>)}
      </div>
      <button type="button" title="删除图片" aria-label="删除图片" onClick={deleteImage}><Trash2 size={16}/></button>
    </div>}
    <EditorContent editor={editor}/>
  </div>;
}
