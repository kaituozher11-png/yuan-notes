import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FileText,
  Eraser,
  FolderOpen,
  GripVertical,
  ImagePlus,
  Highlighter,
  Link2,
  Maximize2,
  Menu,
  Minimize2,
  MoreHorizontal,
  PanelLeftClose,
  PanelRightClose,
  PenLine,
  Paintbrush,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
  Eye,
  EyeOff,
  Settings2,
  Sigma,
  Sparkles,
  Trash2,
  Undo2,
  Redo2,
  Upload,
  UserRound,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { offlineBackup, offlineRestore } from './offlineStore';
import { modelOnline } from './offlineModel';
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { api, json } from "./api";
import { applyModelPreset, modelProviders } from './modelCatalog';
import { aiNotePresets, aiNoteSections, validateAiGuidance, validateAiOutline } from './aiNoteOutline';
import { clampNoteWidth, noteWidthLimits } from './notePaneLayout';
import { seal, openVault } from "./vault";
import Drawing from "./Drawing";
import MindMap from "./MindMap";
import NoteImage from "./NoteImage";
import { freeNoteBlocks, richText } from './richDocument';
import { FormulaEntry, MathDisplay } from "./FormulaDisplay";
import { findSourceBlockRect } from "./sourceLayout";
import { uploadNoteImage, pastedImage } from './noteImages';
const PdfPage = lazy(() => import("./PdfPage"));
const FormulaEditor = lazy(() => import("./FormulaEditor"));
const RichNoteEditor = lazy(() => import("./RichNoteEditor"));

const defaultTemplate = { id: "default", name: "自由笔记", sections: [], style: { accent: '#176d72', paper: 'plain' } };
const stamp = (value) =>
  value ? new Date(value).toLocaleDateString("zh-CN") : "";
const noteSearchText = (note) => {
  const { evidence, ...ai } = note.ai || {};
  const partText = (part) => `${part.text || ''} ${part.nodes?.map((node) => node.text).join(' ') || ''}`;
  return `${note.title} ${note.blocks?.map((block) => `${partText(block)} ${(block.parts || []).map(partText).join(' ')} ${richText(block.rich)}`).join(' ') || ''} ${JSON.stringify(ai)}`.toLowerCase();
};
const sortNotes = (notes) => [...notes].sort((a, b) => (a.order ?? (a.kind === 'ai' ? 0 : 1000)) - (b.order ?? (b.kind === 'ai' ? 0 : 1000)) || a.createdAt.localeCompare(b.createdAt));
const id = () => crypto.randomUUID();
const blankModelForm = {
  name: '', endpoint: '', model: '', key: '', passphrase: '', vision: false,
};
const modelStorageKey = (account) => account?.id ? `yingxing.models.${account.id}` : 'yingxing.models';
const loadModels = (account) => {
  try {
    return JSON.parse(localStorage.getItem(modelStorageKey(account)) || "[]");
  } catch {
    return [];
  }
};
const saveModels = (models, account) =>
  localStorage.setItem(modelStorageKey(account), JSON.stringify(models));
const isDeepSeekEndpoint = (endpoint) => {
  try { return new URL(endpoint).hostname.toLowerCase() === 'api.deepseek.com'; }
  catch { return false; }
};
const IconButton = ({ title, onClick, children, className = "", disabled }) => (
  <button
    type="button"
    className={`icon-button ${className}`}
    aria-label={title}
    title={title}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
);
const Markdown = ({ children }) => (
  <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
    {String(children || "")}
  </ReactMarkdown>
);

function AnnotationContent({ items = [] }) {
  const visible = items.filter((item) => item.type === 'image' ? item.data : item.text?.trim());
  if (!visible.length) return <span className="muted">尚未添加批注</span>;
  return visible.map((item) => (
    <div className="annotation-content" key={item.id}>
      {item.type === "image" ? (
        <figure><img src={item.data} alt={item.text || "批注图片"} />{item.text && <figcaption>{item.text}</figcaption>}</figure>
      ) : item.type === "formula" ? (
        <MathDisplay latex={item.text} />
      ) : (
        <Markdown>{item.text || ""}</Markdown>
      )}
    </div>
  ));
}

function AnnotationTooltip({ link, position }) {
  if (!link || !position) return null;
  const width = Math.min(340, window.innerWidth - 24);
  const maxHeight = Math.min(320, window.innerHeight * 0.7);
  return createPortal(
    <div className="annotation-tooltip" role="tooltip" style={{ left: Math.max(12, Math.min(position.x + 14, window.innerWidth - width - 12)), top: Math.max(12, Math.min(position.y + 14, window.innerHeight - maxHeight - 12)), width }}>
      <strong>{link.note.title}</strong>
      <small>原文第 {link.page} 页{link.quote ? ` · ${link.quote.slice(0, 48)}` : link.label ? ` · ${link.label}` : ""}</small>
      <AnnotationContent items={link.annotations} />
    </div>,
    document.body,
  );
}

function NoteEditor({ note, update, addLink, onJump, onEditRegion, onRemoveLink, saveStatus, editingLinkId, setEditingLinkId }) {
  const [editingAi, setEditingAi] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const annotationInputRef = useRef(null);
  const annotationUploadTarget = useRef(null);
  const currentNote = useRef(note);
  currentNote.current = note;
  const history = useRef({ past: [], future: [], lastAt: 0 });
  const [, refreshHistory] = useState(0);
  function patch(changes) {
    const now = Date.now();
    if (now - history.current.lastAt > 700 || !history.current.past.length) {
      history.current.past.push(note);
      if (history.current.past.length > 50) history.current.past.shift();
    }
    history.current.lastAt = now;
    history.current.future = [];
    refreshHistory((n) => n + 1);
    update({ ...currentNote.current, ...changes });
  }
  function undo() {
    const previous = history.current.past.pop();
    if (!previous) return;
    history.current.future.push(note);
    history.current.lastAt = 0;
    refreshHistory((n) => n + 1);
    update(previous);
  }
  function redo() {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(note);
    history.current.lastAt = 0;
    refreshHistory((n) => n + 1);
    update(next);
  }
  function blockPatch(blockId, changes) {
    patch({
      blocks: currentNote.current.blocks.map((block) =>
        block.id === blockId ? { ...block, ...changes } : block,
      ),
    });
  }
  function addMixedBlock() {
    const block = { id: id(), type: 'mixed', rich: { type: 'doc', content: [{ type: 'paragraph' }] } };
    patch({ blocks: [...currentNote.current.blocks, block] });
    setSelectedBlock(block.id);
  }
  async function pasteTextBlockImage(event, block) {
    const file = pastedImage(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    const start = event.target.selectionStart;
    const end = event.target.selectionEnd;
    try {
      const uploaded = await uploadNoteImage(file);
      const latest = currentNote.current.blocks.find((item) => item.id === block.id);
      if (!latest || latest.type !== 'text') return;
      const parts = [
        { id: id(), type: 'text', text: latest.text.slice(0, start) },
        { id: id(), type: 'image', data: uploaded.url, text: file.name || '' },
        { id: id(), type: 'text', text: latest.text.slice(end) },
      ];
      blockPatch(block.id, { type: 'mixed', parts });
    } catch (error) { alert(`图片粘贴失败：${error.message}`); }
  }
  function changeLink(linkId, change) {
    patch({ links: (currentNote.current.links || []).map((link) => link.id === linkId ? change(link) : link) });
  }
  function addAnnotation(linkId, type) {
    changeLink(linkId, (link) => ({ ...link, annotations: [...(link.annotations || []), { id: id(), type, text: "", data: "" }] }));
  }
  async function annotationFile(file) {
    const linkId = annotationUploadTarget.current;
    if (!file || !linkId) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) return alert("请选择 PNG、JPEG、GIF 或 WebP 图片");
    if (file.size > 5 * 1024 * 1024) return alert("图片不能超过 5 MB");
    try {
      const form = new FormData(); form.append('image', file);
      const uploaded = await api('/images', { method: 'POST', body: form });
      if (!(currentNote.current.links || []).some((link) => link.id === linkId)) return;
      changeLink(linkId, (link) => ({ ...link, annotations: [...(link.annotations || []), { id: id(), type: 'image', data: uploaded.url, text: file.name }] }));
    } catch (error) { alert(`图片上传失败：${error.message}`); }
  }
  const sourceLinks = note.links || [];
  const freeBlocks = note.kind === 'user' && note.blocks.length ? freeNoteBlocks(note.blocks) : note.blocks;
  function updateFreeNote(blockId, rich) {
    patch({ blocks: freeNoteBlocks(currentNote.current.blocks).map((block) =>
      block.id === blockId ? { ...block, rich } : block) });
  }
  function changeFreeBlock(blockId, changes) {
    patch({ blocks: freeNoteBlocks(currentNote.current.blocks).map((block) =>
      block.id === blockId ? { ...block, ...changes } : block) });
  }
  function addMindMap(afterId) {
    const block = { id: id(), type: 'mindmap', nodes: [{ id: id(), text: '中心主题', x: 70, y: 110, shape: 'rectangle' }], edges: [] };
    const blocks = note.kind === 'user' ? freeNoteBlocks(currentNote.current.blocks) : [...currentNote.current.blocks];
    const index = blocks.findIndex((item) => item.id === afterId);
    blocks.splice(index + 1, 0, block);
    patch({ blocks });
    setSelectedBlock(block.id);
  }
  return (
    <div className={`note-editor paper-${note.style?.paper || 'plain'}`} key={note.id} style={{ '--note-accent': note.style?.accent || '#176d72' }}>
      <h2 className="sr-only">{note.title}</h2>
      <div className="note-title-row">
        <div>
          <span className="eyebrow">
            {note.kind === "ai" ? "智能笔记" : "我的笔记"} · 原文第 {note.page}{" "}
            页
          </span>
          <input
            className="note-title"
            aria-label="笔记标题"
            value={note.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </div>
        <div className="note-history"><IconButton title="撤销" disabled={!history.current.past.length} onClick={undo}><Undo2 size={17}/></IconButton><IconButton title="重做" disabled={!history.current.future.length} onClick={redo}><Redo2 size={17}/></IconButton><span className={`save-label ${saveStatus === 'error' ? 'error' : ''}`}>{saveStatus === 'saving' ? '保存中…' : saveStatus === 'error' ? '保存失败' : '已保存'}</span></div>
      </div>
      {note.kind === "ai" && (
        <div className="ai-content">
          {note.ai ? (
            <>
              <div className="ai-heading">
                <Sparkles size={16} /> 依据原文生成{" "}
                <button
                  className="text-button"
                  onClick={() => setEditingAi(!editingAi)}
                >
                  {editingAi ? "完成修改" : "修改内容"}
                </button>
              </div>
              {aiNoteSections(note.ai).map(({ key, title, value, kind, index }) => {
                return (
                  <section className="ai-section" key={key}>
                    {editingAi && kind === 'custom' ? (
                      <input
                        className="ai-section-title-edit"
                        aria-label={`${title} 标题`}
                        value={title}
                        maxLength={60}
                        onChange={(e) => patch({ ai: { ...note.ai, sections: note.ai.sections.map((section, position) => position === index ? { ...section, title: e.target.value } : section) } })}
                      />
                    ) : <h3>{title}</h3>}
                    {editingAi ? (
                      <textarea
                        aria-label={title}
                        value={Array.isArray(value) ? value.join("\n") : value}
                        onChange={(e) =>
                          patch({
                            ai: kind === 'custom'
                              ? { ...note.ai, sections: note.ai.sections.map((section, position) => position === index ? { ...section, content: e.target.value } : section) }
                              : { ...note.ai, [key]: Array.isArray(value) ? e.target.value.split("\n") : e.target.value },
                          })
                        }
                      />
                    ) : kind === 'formula' && Array.isArray(value) ? (
                      <div className="ai-formula-list">
                        {value.map((item, index) => <FormulaEntry value={item} key={index} />)}
                      </div>
                    ) : Array.isArray(value) ? (
                      <ul>
                        {value.map((item, index) => (
                          <li key={index}>
                            <Markdown>{item}</Markdown>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Markdown>{value}</Markdown>
                    )}
                  </section>
                );
              })}
            </>
          ) : (
            <div className="ai-placeholder">
              <Sparkles size={22} />
              <strong>这一页还没有生成笔记</strong>
              <span>{window.YuanOfflineApp ? '联网后可生成智能笔记；离线时可添加个人笔记。' : '配置模型后可从上方“生成笔记”开始。'}</span>
            </div>
          )}
        </div>
      )}
      <div className="personal-heading">
        <h3>{note.kind === "ai" ? "我的补充" : "笔记内容"}</h3>
        {!note.blocks.length && <button className="small-primary" onClick={addMixedBlock}><Plus size={15} /> 开始笔记</button>}
      </div>
      {!note.blocks.length && (
        <div className="empty-block">
          写下自己的理解。
        </div>
      )}
      {freeBlocks.map((block, index) => (
        <div
          className={`note-block ${selectedBlock === block.id ? "selected" : ""}`}
          key={block.id}
          onClick={() => setSelectedBlock(block.id)}
        >
          <div className="block-top">
            <span>
              {
                {
                  text: "文字",
                  formula: "公式",
                  drawing: "手写",
                  image: "图片",
                  mindmap: "思维导图",
                  mixed: "笔记内容",
                }[block.type]
              }
            </span>
            <div>
              <IconButton
                title="上移"
                disabled={index === 0}
                onClick={() => {
                  const arr = [...freeBlocks];
                  [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
                  patch({ blocks: arr });
                }}
              >
                <ChevronDown className="rotate-up" size={15} />
              </IconButton>
              <IconButton
                title="下移"
                disabled={index === freeBlocks.length - 1}
                onClick={() => {
                  const arr = [...freeBlocks];
                  [arr[index + 1], arr[index]] = [arr[index], arr[index + 1]];
                  patch({ blocks: arr });
                }}
              >
                <ChevronDown size={15} />
              </IconButton>
              <IconButton
                title="删除区块"
                onClick={() => {
                  if (confirm("删除这个区块？"))
                    patch({
                      blocks: freeBlocks.filter((item) => item.id !== block.id),
                    });
                }}
              >
                <X size={15} />
              </IconButton>
            </div>
          </div>
          {block.type === 'mixed' && <Suspense fallback={<div className="rich-note-loading">正在打开笔记编辑区…</div>}><RichNoteEditor block={block} onInsertMindMap={() => addMindMap(block.id)} onChange={(rich) => note.kind === 'user' ? updateFreeNote(block.id, rich) : blockPatch(block.id, { rich })} /></Suspense>}
          {block.type === "text" && (
            <textarea
              className="text-block"
              aria-label="笔记文字"
              placeholder="输入笔记；支持 Markdown 和 $公式$"
              value={block.text}
              onPaste={(event) => pasteTextBlockImage(event, block)}
              onChange={(e) => blockPatch(block.id, { text: e.target.value })}
            />
          )}
          {block.type === "text" && block.text && (
            <div className="markdown-preview">
              <Markdown>{block.text}</Markdown>
            </div>
          )}
          {block.type === "formula" && (
            <Suspense fallback={<div className="formula-loading">正在打开公式编辑器…</div>}>
              <FormulaEditor value={block.text || ""} onChange={(text) => blockPatch(block.id, { text })} label="笔记公式" />
            </Suspense>
          )}
          {block.type === "drawing" && (
            <Drawing
              value={block.strokes}
              height={block.height}
              onChange={(strokes) => blockPatch(block.id, { strokes })}
              onHeightChange={(height) => blockPatch(block.id, { height })}
            />
          )}
          {block.type === "image" && (
            <NoteImage block={block} onChange={(changes) => blockPatch(block.id, changes)} />
          )}
          {block.type === "mindmap" && (
            <MindMap
              value={{ nodes: block.nodes, edges: block.edges }}
              onChange={(map) => note.kind === 'user' ? changeFreeBlock(block.id, map) : blockPatch(block.id, map)}
            />
          )}
        </div>
      ))}
      <div className="links-heading">
        <h3>关联原文</h3>
        <button className="text-button" onClick={() => addLink(selectedBlock)}>
          <Link2 size={15} /> 关联当前选区或原文页
        </button>
      </div>
      <div className="link-list">
        {sourceLinks.map((link) => (
          <div className="source-link-item" key={link.id} id={`link-${link.id}`}>
            <div className="source-link-row">
              <button className="source-link-jump" onClick={() => onJump(link.page, link.quote, link.rects?.[0] || link.rect)} title="跳转到关联原文">
                <Link2 size={14} /> 第 {link.page} 页{link.quote ? ` · ${link.quote.slice(0, 24)}` : link.label ? ` · ${link.label.slice(0, 24)}` : link.rect ? " · 框选区域" : " · 整页"}
              </button>
              {link.rect && !link.quote && <IconButton title="调整框选" onClick={() => onEditRegion(note, link)}><Maximize2 size={15} /></IconButton>}
              <IconButton title={editingLinkId === link.id ? "收起批注" : "编辑批注"} onClick={() => setEditingLinkId(editingLinkId === link.id ? null : link.id)}><PenLine size={15} /></IconButton>
              <IconButton title="移除关联" onClick={() => { patch({ links: sourceLinks.filter((item) => item.id !== link.id) }); onRemoveLink(link.id); if (editingLinkId === link.id) setEditingLinkId(null); }}><X size={15} /></IconButton>
            </div>
            {editingLinkId === link.id && (
              <div className="annotation-editor">
                {(link.annotations || []).map((item) => (
                  <div className="annotation-entry" key={item.id}>
                    <div className="annotation-entry-head">
                      <span>{item.type === 'formula' ? '公式' : item.type === 'image' ? '图片' : '文字'}</span>
                      <IconButton title="删除批注内容" onClick={() => changeLink(link.id, (current) => ({ ...current, annotations: current.annotations.filter((entry) => entry.id !== item.id) }))}><X size={14} /></IconButton>
                    </div>
                    {item.type === 'image' ? (
                      <><img src={item.data} alt={item.text || '批注图片'} /><input aria-label="批注图片说明" value={item.text || ''} onChange={(event) => changeLink(link.id, (current) => ({ ...current, annotations: current.annotations.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry) }))} /></>
                    ) : item.type === 'formula' ? (
                      <Suspense fallback={<div className="formula-loading">正在打开公式编辑器…</div>}>
                        <FormulaEditor value={item.text || ''} onChange={(text) => changeLink(link.id, (current) => ({ ...current, annotations: current.annotations.map((entry) => entry.id === item.id ? { ...entry, text } : entry) }))} label="批注公式" />
                      </Suspense>
                    ) : (
                      <><textarea aria-label="批注文字" placeholder="输入批注；支持 Markdown 与 $公式$" value={item.text || ''} onChange={(event) => changeLink(link.id, (current) => ({ ...current, annotations: current.annotations.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry) }))} />{item.text && <div className="annotation-preview"><AnnotationContent items={[item]} /></div>}</>
                    )}
                  </div>
                ))}
                <div className="annotation-add">
                  <button onClick={() => addAnnotation(link.id, 'text')}><Plus size={14} /> 文字</button>
                  <button onClick={() => addAnnotation(link.id, 'formula')}><Sigma size={14} /> 公式</button>
                  <button onClick={() => { annotationUploadTarget.current = link.id; annotationInputRef.current?.click(); }}><ImagePlus size={14} /> 图片</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {!sourceLinks.length && (
          <span className="muted">选择原文文字或框选页面区域后关联到这篇笔记。</span>
        )}
      </div>
      <input ref={annotationInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(event) => { annotationFile(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
  );
}

export default function App({ account, onAccount }) {
  const [data, setData] = useState({ docs: [], notes: [], templates: [] });
  const [saveStatus, setSaveStatus] = useState({});
  const [screen, setScreen] = useState("library");
  const [docId, setDocId] = useState(null);
  const [page, setPage] = useState(1);
  const [notePage, setNotePage] = useState(1);
  const [followPage, setFollowPage] = useState(true);
  const [noteId, setNoteId] = useState(null);
  const [layout, setLayout] = useState('doc');
  const [noteWidth, setNoteWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('yingxing-note-width'));
      return Number.isFinite(saved) && saved >= 220 ? saved : 440;
    } catch { return 440; }
  });
  const [panelWidth, setPanelWidth] = useState(0);
  const [treeOpen, setTreeOpen] = useState(() => window.innerWidth > 1000);
  const [zoom, setZoom] = useState(() => window.innerWidth <= 600 ? 1.6 : 1);
  const [query, setQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState("all");
  const [sourcePage, setSourcePage] = useState({ text: '', blocks: [] });
  const [highlight, setHighlight] = useState("");
  const [highlightRect, setHighlightRect] = useState(null);
  const [selectedRect, setSelectedRect] = useState(null);
  const [editingRegion, setEditingRegion] = useState(null);
  const [selectedRects, setSelectedRects] = useState([]);
  const [selectedQuote, setSelectedQuote] = useState("");
  const [editingLinkId, setEditingLinkId] = useState(null);
  const [hoveredAnnotation, setHoveredAnnotation] = useState(null);
  const [regionMode, setRegionMode] = useState(false);
  const [markupOpen, setMarkupOpen] = useState(false);
  const [markupTool, setMarkupTool] = useState(null);
  const [stickyPlacement, setStickyPlacement] = useState('single');
  const [markupColors, setMarkupColors] = useState({ pen: '#d64545', highlighter: '#e4c13d' });
  const markupColor = markupColors[markupTool === 'highlighter' ? 'highlighter' : 'pen'];
  const [markupSize, setMarkupSize] = useState(3);
  const [showStickies, setShowStickies] = useState(() => {
    try { return localStorage.getItem('yingxing.stickiesHidden') !== 'true'; }
    catch { return true; }
  });
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState("");
  const [file, setFile] = useState(null);
  const [course, setCourse] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState(() => loadModels(account));
  const [keys, setKeys] = useState({});
  const [modelForm, setModelForm] = useState({ ...blankModelForm });
  const [modelPreset, setModelPreset] = useState('');
  const [unlockPhrase, setUnlockPhrase] = useState("");
  const [modelId, setModelId] = useState(null);
  const [modelTestResult, setModelTestResult] = useState(null);
  const [editingModel, setEditingModel] = useState(null);
  const [range, setRange] = useState("current");
  const [rangeText, setRangeText] = useState("");
  const [aiOutline, setAiOutline] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`yingxing.ai-outline.${account?.id || 'local'}`));
      return { preset: saved.preset, titles: validateAiOutline(saved.titles), guidance: validateAiGuidance(saved.guidance || '') };
    } catch { return { preset: 'course', titles: [...aiNotePresets.course.titles], guidance: '' }; }
  });
  const [progress, setProgress] = useState(null);
  const [preview, setPreview] = useState(null);
  const toastTimer = useRef(null);
  const stopRef = useRef(false);
  const saves = useRef(new Map());
  const panelsRef = useRef(null);
  const noteResize = useRef(null);
  const markupSaves = useRef(new Map());
  const restoreInput = useRef(null);

  useEffect(() => {
    api("/state")
      .then(setData)
      .catch((e) => notify(e.message));
  }, []);
  useEffect(() => {
    saveModels(models, account);
  }, [models, account]);
  useEffect(() => {
    localStorage.setItem(`yingxing.ai-outline.${account?.id || 'local'}`, JSON.stringify(aiOutline));
  }, [aiOutline, account]);
  useEffect(() => {
    if (screen !== 'workspace' || !panelsRef.current) return;
    const element = panelsRef.current;
    const observer = new ResizeObserver(() => setPanelWidth(element.clientWidth));
    observer.observe(element);
    setPanelWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [screen]);
  useEffect(() => {
    const compact = window.matchMedia('(max-width: 1000px)');
    const collapseOnCompact = (event) => {
      if (event.matches) setTreeOpen(false);
    };
    compact.addEventListener('change', collapseOnCompact);
    return () => compact.removeEventListener('change', collapseOnCompact);
  }, []);
  useEffect(() => {
    try { localStorage.setItem('yingxing-note-width', String(noteWidth)); } catch { /* Ignore unavailable storage. */ }
  }, [noteWidth]);
  useEffect(() => {
    try { localStorage.setItem('yingxing.stickiesHidden', String(!showStickies)); } catch { /* Ignore unavailable storage. */ }
  }, [showStickies]);
  const overlayNotes = window.innerWidth <= 960;
  const visibleNoteWidth = panelWidth ? clampNoteWidth(noteWidth, panelWidth, overlayNotes) : noteWidth;
  const noteLimits = noteWidthLimits(panelWidth, overlayNotes);
  function resizeNoteAt(clientX) {
    const element = panelsRef.current;
    if (!element || !noteResize.current) return;
    const bounds = element.getBoundingClientRect();
    const width = clampNoteWidth(bounds.right - clientX, bounds.width, window.innerWidth <= 960);
    element.style.setProperty('--note-width', `${width}px`);
    noteResize.current.width = width;
  }
  function endNoteResize(event) {
    if (noteResize.current?.pointerId !== event.pointerId) return;
    setNoteWidth(noteResize.current.width);
    noteResize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function notify(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }
  const doc = data.docs.find((x) => x.id === docId && !x.deleted);
  const pageMarkup = doc?.markup?.[page] || { strokes: [], stickies: [] };
  function updatePageMarkup(next, immediate = false) {
    const targetDoc = docId;
    const targetPage = page;
    const key = `${targetDoc}:${targetPage}`;
    setData((old) => ({ ...old, docs: old.docs.map((item) => item.id === targetDoc
      ? { ...item, markup: { ...(item.markup || {}), [targetPage]: next } } : item) }));
    const pending = markupSaves.current.get(key) || { chain: Promise.resolve() };
    clearTimeout(pending.timer);
    const save = () => {
      pending.chain = pending.chain.catch(() => {}).then(() => api(`/docs/${targetDoc}/pages/${targetPage}/markup`, json('PUT', next))).catch((error) => notify(`原文标记保存失败：${error.message}`));
    };
    if (immediate) save();
    else pending.timer = setTimeout(save, 300);
    markupSaves.current.set(key, pending);
  }
  const pageNotes = sortNotes(data.notes.filter(
    (x) => x.docId === docId && x.page === notePage && !x.deleted,
  ));
  const linkedNotes = data.notes
    .filter((x) => x.docId === docId && !x.deleted)
    .flatMap((n) =>
      (n.links || [])
        .filter((l) => l.page === page)
        .map((l) => ({ ...l, note: n })),
    );
  const visibleLinks = linkedNotes.map((link) => link.quote && !link.rect && !link.rects?.length
    ? { ...link, rect: findSourceBlockRect(sourcePage, link.quote, link.textStart) }
    : link);
  const resolvedHighlightRect = highlightRect || (highlight && findSourceBlockRect(sourcePage, highlight));
  const hoveredLink = linkedNotes.find((link) => link.id === hoveredAnnotation?.id);
  const note =
    pageNotes.find((x) => x.id === noteId) ||
    pageNotes.find((x) => x.kind === "ai") ||
    pageNotes[0];
  const activeModel = models.find((x) => x.id === modelId) || models[0];
  const selectedKey = activeModel && keys[activeModel.id];
  const filteredDocs = useMemo(
    () => data.docs.filter((x) => {
      if (x.deleted) return false;
      const notes = data.notes.filter((n) => n.docId === x.id && !n.deleted);
      if (libraryFilter === 'ungenerated' && notes.filter((n) => n.kind === 'ai').length >= x.pages) return false;
      if (libraryFilter === 'mine' && !notes.some((n) => n.kind === 'user' || n.blocks?.length)) return false;
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return `${x.name} ${x.course} ${x.filename}`.toLowerCase().includes(needle) || notes.some((n) => noteSearchText(n).includes(needle));
    }),
    [data.docs, data.notes, query, libraryFilter],
  );

  async function reload() {
    setData(await api("/state"));
  }
  function updateNote(next) {
    setData((old) => ({
      ...old,
      notes: old.notes.map((n) => (n.id === next.id ? next : n)),
    }));
    setSaveStatus((old) => ({ ...old, [next.id]: 'saving' }));
    clearTimeout(saves.current.get(next.id)?.timer);
    const timer = setTimeout(async () => {
      saves.current.delete(next.id);
      try { await api(`/notes/${next.id}`, json("PUT", next)); setSaveStatus((old) => ({ ...old, [next.id]: 'saved' })); }
      catch (e) { setSaveStatus((old) => ({ ...old, [next.id]: 'error' })); notify(`保存失败：${e.message}`); }
    }, 400);
    saves.current.set(next.id, { timer, note: next });
  }
  async function flushSaves() {
    const pending = [...saves.current.values()];
    saves.current.clear();
    await Promise.all(
      pending.map(async ({ timer, note: item }) => {
        clearTimeout(timer);
        await api(`/notes/${item.id}`, json("PUT", item));
        setSaveStatus((old) => ({ ...old, [item.id]: 'saved' }));
      }),
    );
  }
  async function createNote(template = defaultTemplate) {
    try {
      const made = await api(
        "/notes",
        json("POST", {
          docId,
          page: notePage,
          title: template.id === "default" ? "我的补充" : template.name,
        }),
      );
      const blocks = [{ id: id(), type: 'mixed', rich: { type: 'doc', content: [
        ...template.sections.flatMap((label) => [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: label }] }, { type: 'paragraph' }]),
        ...(!template.sections.length ? [{ type: 'paragraph' }] : []),
      ] } }];
      await api(`/notes/${made.id}`, json("PUT", { blocks, style: template.style || defaultTemplate.style }));
      await reload();
      setNoteId(made.id);
      setLayout('split');
      notify("已新建笔记页");
    } catch (e) {
      notify(e.message);
    }
  }
  function openDoc(item, targetPage = 1) {
    setDocId(item.id);
    setPage(targetPage);
    setNotePage(targetPage);
    setFollowPage(true);
    setNoteId(null);
    setScreen("workspace");
    setSourcePage({ text: '', blocks: [] });
    setEditingLinkId(null);
    setEditingRegion(null);
    setSelectedRect(null);
    setRegionMode(false);
    setMarkupTool(null);
    setMarkupOpen(false);
    setHoveredAnnotation(null);
    setLayout('doc');
  }
  function jump(targetPage, quote = "", rect = null) {
    if (targetPage !== page) setSourcePage({ text: '', blocks: [] });
    setPage(targetPage);
    setFollowPage(false);
    setHighlight(quote);
    setHighlightRect(rect);
    setSelectedRect(null);
    setEditingRegion(null);
    setRegionMode(false);
    setLayout('split');
    setTimeout(() => {
      if (rect || quote)
        document.querySelector(".pdf-canvas-wrap")?.scrollIntoView({ block: "nearest" });
    }, 100);
  }
  function navigateSource(targetPage) {
    setPage(targetPage);
    if (targetPage !== page) setSourcePage({ text: '', blocks: [] });
    if (followPage) { setNotePage(targetPage); setNoteId(null); }
    setHighlight(""); setHighlightRect(null); setSelectedQuote(""); setSelectedRect(null); setSelectedRects([]); setHoveredAnnotation(null); setEditingRegion(null); setRegionMode(false);
  }
  function editRegion(targetNote, link) {
    if (!link.rect) return;
    if (link.page !== page) setSourcePage({ text: '', blocks: [] });
    setPage(link.page);
    setNotePage(targetNote.page);
    setNoteId(targetNote.id);
    setFollowPage(false);
    setLayout('split');
    setHighlight(""); setHighlightRect(null); setSelectedQuote(""); setSelectedRects([]);
    setHoveredAnnotation(null);
    setRegionMode(false);
    setSelectedRect({ ...link.rect });
    setEditingRegion({ noteId: targetNote.id, linkId: link.id });
    setTimeout(() => document.querySelector('.pdf-canvas-wrap')?.scrollIntoView({ block: 'nearest' }), 100);
  }
  function cancelRegionEdit() {
    setEditingRegion(null);
    setSelectedRect(null);
  }
  function saveRegionEdit() {
    if (!editingRegion || !selectedRect) return;
    const targetNote = data.notes.find((item) => item.id === editingRegion.noteId && !item.deleted);
    if (!targetNote?.links?.some((link) => link.id === editingRegion.linkId)) return cancelRegionEdit();
    const rect = { ...selectedRect };
    updateNote({ ...targetNote, links: targetNote.links.map((link) => link.id === editingRegion.linkId ? { ...link, rect, rects: [rect] } : link) });
    cancelRegionEdit();
    notify('框选位置已更新');
  }
  function deleteRegionSelection() {
    if (editingRegion) {
      if (!confirm('删除这个框选及其原文关联和批注？')) return;
      const targetNote = data.notes.find((item) => item.id === editingRegion.noteId && !item.deleted);
      if (targetNote) updateNote({ ...targetNote, links: (targetNote.links || []).filter((link) => link.id !== editingRegion.linkId) });
      if (editingLinkId === editingRegion.linkId) setEditingLinkId(null);
      notify('已删除框选及关联');
    }
    cancelRegionEdit();
  }
  function linkCurrent(blockId, forcedRect = null, label = '') {
    if (editingRegion) { notify('请先保存或取消框选调整'); return; }
    if (!note) { notify("请先新建笔记页，再关联原文"); return; }
    const quote = forcedRect ? '' : selectedQuote || '';
    const rect = forcedRect ? { x: forcedRect.x, y: forcedRect.y, width: forcedRect.width, height: forcedRect.height } : selectedRect;
    const link = { id: id(), page, quote, label, rect, rects: forcedRect ? [rect] : selectedRects, blockId: blockId || null, annotations: [] };
    updateNote({
      ...note,
      links: [...(note.links || []), link],
    });
    setEditingLinkId(link.id);
    setNoteId(note.id);
    setLayout('split');
    setTimeout(() => document.getElementById(`link-${link.id}`)?.scrollIntoView({ block: 'center' }), 100);
    setSelectedQuote("");
    setSelectedRect(null);
    setSelectedRects([]);
    window.getSelection()?.removeAllRanges();
    setRegionMode(false);
    notify(
      quote
        ? "已链接选中的原文文字"
        : label
          ? `已链接${label}`
        : rect
          ? "已链接框选区域"
          : "已链接当前原文页",
    );
  }
  function showAnnotation(link, event) {
    setHoveredAnnotation((current) => current?.id === link.id ? current : { id: link.id, x: event.clientX, y: event.clientY });
  }
  function focusAnnotation(link) {
    setNotePage(link.note.page);
    setFollowPage(false);
    setNoteId(link.note.id);
    setEditingLinkId(link.id);
    setLayout('split');
    setTimeout(() => document.getElementById(`link-${link.id}`)?.scrollIntoView({ block: 'center' }), 100);
  }
  async function importFile(event) {
    event.preventDefault();
    if (!file) return notify("请选择资料文件");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("course", course);
      const made = await api("/docs", { method: "POST", body: form });
      await reload();
      setDialog(null);
      setFile(null);
      setCourse("");
      openDoc(made);
      notify(`已导入 ${made.pages} 页`);
    } catch (e) {
      notify(`导入失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  }
  async function patchDoc(item, changes) {
    try {
      await api(`/docs/${item.id}`, json("PATCH", changes));
      await reload();
      if (changes.deleted) {
        setScreen("library");
        setDocId(null);
      }
    } catch (e) {
      notify(e.message);
    }
  }
  async function duplicateNote(item) {
    try {
      const made = await api(
        "/notes",
        json("POST", {
          docId: item.docId,
          page: item.page,
          title: `${item.title} 副本`,
        }),
      );
      await api(
        `/notes/${made.id}`,
        json("PUT", { blocks: item.blocks, links: item.links }),
      );
      await reload();
      setNoteId(made.id);
    } catch (e) {
      notify(e.message);
    }
  }
  async function moveNote(direction) {
    if (!note) return;
    const current = pageNotes.findIndex((item) => item.id === note.id);
    const destination = current + direction;
    if (destination < 0 || destination >= pageNotes.length) return;
    try {
      await flushSaves();
      const ids = pageNotes.map((item) => item.id);
      [ids[current], ids[destination]] = [ids[destination], ids[current]];
      await api('/notes/reorder', json('POST', { ids }));
      await reload();
    } catch (e) { notify(e.message); }
  }
  async function removeNote(item) {
    if (!confirm(`删除“${item.title}”？可在回收站恢复。`)) return;
    await api(`/notes/${item.id}`, json("PUT", { deleted: true }));
    await reload();
    setNoteId(null);
  }
  async function saveModel(event) {
    event.preventDefault();
    try {
      if (!modelForm.endpoint.trim() || !modelForm.model.trim() || !modelForm.key.trim())
        throw new Error("请填写接口地址、模型名称和密钥");
      const encrypted = await seal(modelForm.key, modelForm.passphrase);
      const made = {
        id: id(),
        name: modelForm.name || modelForm.model,
        endpoint: modelForm.endpoint.trim(),
        model: modelForm.model.trim(),
        vision: modelForm.vision,
        encrypted,
      };
      setModels((current) => [...current, made]);
      setKeys((current) => ({ ...current, [made.id]: modelForm.key }));
      setModelId(made.id);
      setModelTestResult(null);
      setEditingModel(null);
      setModelForm({ ...blankModelForm });
      setModelPreset('');
      notify("模型连接已保存");
    } catch (e) {
      notify(e.message);
    }
  }
  async function unlockModel() {
    try {
      if (!activeModel) throw new Error('请先选择模型连接');
      const key = await openVault(activeModel.encrypted, unlockPhrase);
      setKeys((current) => ({ ...current, [activeModel.id]: key }));
      setUnlockPhrase("");
      notify("模型连接已解锁");
    } catch (e) {
      notify(e.message);
    }
  }
  async function testModel() {
    if (window.YuanOfflineApp && !modelOnline()) return notify('无法生成智能笔记，请联网');
    if (!activeModel || !selectedKey) return notify("请先选择并解锁模型连接");
    setBusy(true);
    setModelTestResult({ id: activeModel.id, type: 'pending', message: '正在测试连接…' });
    try {
      await api(
        "/models/test",
        json("POST", {
          endpoint: activeModel.endpoint,
          model: activeModel.model,
          key: selectedKey,
        }),
      );
      setModelTestResult({ id: activeModel.id, type: 'success', message: '连接和基本笔记格式测试成功；页面图片能力未验证' });
      notify("连接和基本笔记格式测试成功");
    } catch (e) {
      const message = `连接测试失败：${e.message}`;
      setModelTestResult({ id: activeModel.id, type: 'error', message });
      notify(message);
    } finally {
      setBusy(false);
    }
  }
  function saveModelId(event) {
    event.preventDefault();
    const model = editingModel?.model.trim();
    if (!model) return notify('请填写模型 ID');
    setModels((current) => current.map((item) => item.id === editingModel.id ? { ...item, model } : item));
    setEditingModel(null);
    setModelTestResult(null);
    notify('模型 ID 已更新，请重新测试连接');
  }
  function pagesToGenerate() {
    if (range === "current") return [page];
    if (range === "all")
      return Array.from({ length: doc.pages }, (_, i) => i + 1);
    const found = new Set();
    for (const chunk of rangeText.split(/[,，]/)) {
      const match = chunk.trim().match(/^(\d+)(?:\s*[-－]\s*(\d+))?$/);
      if (!match) throw new Error("页码格式示例：1-3,5");
      const a = Number(match[1]),
        b = Number(match[2] || match[1]);
      if (a < 1 || b > doc.pages || b < a)
        throw new Error(`页码须在 1 到 ${doc.pages} 之间`);
      for (let n = a; n <= b; n++) found.add(n);
    }
    if (!found.size) throw new Error("请输入页码");
    return [...found].sort((a, b) => a - b);
  }
  async function runGeneration() {
    try {
      if (window.YuanOfflineApp && !modelOnline()) throw new Error('无法生成智能笔记，请联网');
      if (!activeModel || !selectedKey)
        throw new Error("请先在模型连接页配置并解锁 API");
      const outline = validateAiOutline(aiOutline.titles);
      const guidance = validateAiGuidance(aiOutline.guidance);
      await flushSaves();
      const pages = pagesToGenerate();
      stopRef.current = false;
      setBusy(true);
      setProgress({ done: 0, total: pages.length, page: pages[0], errors: [] });
      if (
        pages.length === 1 &&
        data.notes.some(
          (n) =>
            n.docId === docId &&
            n.page === pages[0] &&
            n.kind === "ai" &&
            !n.deleted,
        )
      ) {
        const candidate = await api(
          "/generate",
          json("POST", {
            docId,
            page: pages[0],
            endpoint: activeModel.endpoint,
            model: activeModel.model,
            key: selectedKey,
            vision: activeModel.vision,
            outline,
            guidance,
            preview: true,
          }),
        );
        setPreview({ ...candidate, page: pages[0] });
        setProgress(null);
        setBusy(false);
        return;
      }
      for (let i = 0; i < pages.length; i++) {
        if (stopRef.current) break;
        const target = pages[i];
        setProgress((p) => ({ ...p, page: target }));
        if (
          data.notes.some(
            (n) =>
              n.docId === docId &&
              n.page === target &&
              n.kind === "ai" &&
              !n.deleted,
          )
        ) {
          setProgress((p) => ({
            ...p,
            done: i + 1,
            errors: [
              ...p.errors,
              `第 ${target} 页已有智能笔记，已跳过；单独选择该页可预览替换`,
            ],
          }));
          continue;
        }
        try {
          await api(
            "/generate",
            json("POST", {
              docId,
              page: target,
              endpoint: activeModel.endpoint,
              model: activeModel.model,
              key: selectedKey,
              vision: activeModel.vision,
              outline,
              guidance,
            }),
          );
          await reload();
        } catch (e) {
          setProgress((p) => ({
            ...p,
            errors: [...p.errors, `第 ${target} 页：${e.message}`],
          }));
        }
        setProgress((p) => ({ ...p, done: i + 1 }));
      }
      notify(stopRef.current ? "已停止，已完成的笔记保留" : "生成任务已结束");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function acceptPreview() {
    try {
      await flushSaves();
      await api("/generate/commit", json("POST", { token: preview.token }));
      await reload();
      setPreview(null);
      setDialog(null);
      notify("已替换智能笔记，个人补充已保留");
    } catch (e) {
      notify(e.message);
    }
  }
  async function exportNotes() {
    const { exportDocument } = await import("./export");
    try { await flushSaves(); await exportDocument(doc, data.notes); }
    catch (error) { notify(`导出失败：${error.message}`); }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setScreen("library")}>
          <span className="brand-mark">✦</span>
          <span>源笔记</span>
        </button>
        <div className="header-spacer" />
        <div className="header-actions">
          {screen === "workspace" && (
            <>
              <span className="header-doc-name">{doc?.name}</span>
              <button
                className="primary-button"
                title="生成笔记"
                aria-label="生成笔记"
                onClick={() => window.YuanOfflineApp && !modelOnline() ? notify('无法生成智能笔记，请联网') : setDialog("generate")}
              >
                <Sparkles size={16} /> 生成笔记
              </button>
            </>
          )}
          <IconButton title="模型连接" onClick={() => setScreen("models")}>
            <Settings2 size={19} />
          </IconButton>
          {account && <IconButton title={`账号：${account.username}`} onClick={onAccount}><UserRound size={19} /></IconButton>}
        </div>
      </header>
      <div className="app-body">
        <aside className="global-nav" aria-label="主导航">
          <button
            className={screen === "library" ? "nav-item active" : "nav-item"}
            onClick={() => setScreen("library")}
            title="资料库"
          >
            <FolderOpen size={20} />
            <span>资料库</span>
          </button>
          <button
            className={screen === "templates" ? "nav-item active" : "nav-item"}
            onClick={() => setScreen("templates")}
            title="笔记模板"
          >
            <BookOpen size={20} />
            <span>模板</span>
          </button>
          <button
            className={screen === "models" ? "nav-item active" : "nav-item"}
            onClick={() => setScreen("models")}
            title="模型连接"
          >
            <Settings2 size={20} />
            <span>模型</span>
          </button>
          <button
            className={screen === "trash" ? "nav-item active" : "nav-item"}
            onClick={() => setScreen("trash")}
            title="回收站"
          >
            <Trash2 size={20} />
            <span>回收站</span>
          </button>
        </aside>
        {screen === "library" && (
          <main className="library">
            <div className="page-head">
              <div>
                <span className="eyebrow">LEARNING WORKSPACE</span>
                <h1>我的资料</h1>
                <p>从上次阅读的地方，继续整理你的知识。</p>
              </div>
              <button
                className="primary-button"
                onClick={() => setDialog("import")}
              >
                <Upload size={17} /> 导入资料
              </button>
            </div>
            <div className="library-toolbar">
              <div className="search-box">
                <Search size={18} />
                <input
                  aria-label="搜索资料"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索资料或课程"
                />
              </div>
              <select className="library-filter" aria-label="筛选资料" value={libraryFilter} onChange={(e) => setLibraryFilter(e.target.value)}><option value="all">全部资料</option><option value="ungenerated">未生成完</option><option value="mine">我的笔记</option></select>
              <span>{filteredDocs.length} 份资料</span>
              {data.docs.length > 0 && (window.YuanOfflineApp
                ? <button className="backup-link" type="button" onClick={() => offlineBackup().catch((error) => notify(`备份失败：${error.message}`))}><Download size={15}/> 备份资料库</button>
                : <a className="backup-link" href="/api/backup" download><Download size={15}/> 备份资料库</a>)}
              {window.YuanOfflineApp && <><button className="backup-link" type="button" onClick={() => restoreInput.current?.click()}><Upload size={15}/> 恢复备份</button><input ref={restoreInput} type="file" accept=".zip,application/zip" hidden onChange={async (event) => { const backup = event.target.files?.[0]; event.target.value = ''; if (!backup || !confirm('恢复备份会替换手机内现有的资料和笔记。请先备份当前资料，确定继续？')) return; try { const count = await offlineRestore(backup); await reload(); setScreen('library'); setDocId(null); notify(`已恢复 ${count} 份资料`); } catch (error) { notify(`恢复失败：${error.message}`); } }}/></>}
            </div>
            {filteredDocs.length ? (
              <div className="doc-list">
                {filteredDocs.map((item) => {
                  const count = data.notes.filter(
                    (n) => n.docId === item.id && n.kind === "ai" && !n.deleted,
                  ).length;
                  const needle = query.trim().toLowerCase();
                  const matchedNote = needle && !`${item.name} ${item.course} ${item.filename}`.toLowerCase().includes(needle) ? data.notes.find((n) => n.docId === item.id && !n.deleted && noteSearchText(n).includes(needle)) : null;
                  return (
                    <div className="doc-row" key={item.id}>
                      <button
                        className="doc-row-open"
                        onClick={() => openDoc(item, matchedNote?.page || 1)}
                        aria-label={`打开资料：${item.name}`}
                      >
                        <div className="doc-icon">
                          <FileText size={22} />
                        </div>
                        <div className="doc-main">
                          <strong>{item.name}</strong>
                          <span>
                            {item.course || "未分类"} · {item.type} · {item.pages}{" "}
                            页
                          </span>
                          {matchedNote && <small>命中：第 {matchedNote.page} 页 · {matchedNote.title}</small>}
                        </div>
                        <div className="doc-progress">
                          <div>
                            <span
                              style={{ width: `${(count / item.pages) * 100}%` }}
                            />
                          </div>
                          <small>
                            已生成 {count}/{item.pages} 页
                          </small>
                        </div>
                        <time>{stamp(item.updatedAt)}</time>
                        <ChevronRight size={18} />
                      </button>
                      <button
                        className="doc-row-delete"
                        aria-label={`删除资料：${item.name}`}
                        title="移入回收站"
                        onClick={() => {
                          if (confirm(`将“${item.name}”移入回收站？资料和笔记可在回收站恢复。`))
                            patchDoc(item, { deleted: true });
                        }}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="library-empty">
                <div className="empty-art">
                  <FileText size={56} />
                  <span>✦</span>
                </div>
                <h2>{query ? "没有匹配的资料" : "从一份资料开始"}</h2>
                <p>
                  {query
                    ? "试试其他关键词。"
                    : "导入课件或讲义后，就可以对照原文写笔记。"}
                </p>
                {!query && (
                  <button
                    className="primary-button"
                    onClick={() => setDialog("import")}
                  >
                    <Upload size={16} /> 导入资料
                  </button>
                )}
              </div>
            )}
          </main>
        )}
        {screen === "workspace" && doc && (
          <main
            className={`workspace layout-${layout} ${treeOpen ? "" : "tree-closed"}`}
          >
            {treeOpen && <button className="page-tree-backdrop" aria-label="关闭页面导航" onClick={() => setTreeOpen(false)} />}
            <aside className="page-tree" aria-label="文档页面导航">
              <div className="tree-head">
                <strong>页面导航</strong>
                <IconButton
                  title="收起页面导航"
                  onClick={() => setTreeOpen(false)}
                >
                  <PanelLeftClose size={17} />
                </IconButton>
              </div>
              <div className="tree-doc">
                {doc.name}
                <small>
                  {doc.pages} 页 · {doc.course || "未分类"}
                </small>
              </div>
              <div className="tree-pages">
                {Array.from({ length: doc.pages }, (_, i) => {
                  const number = i + 1;
                  const notes = sortNotes(data.notes.filter(
                    (n) => n.docId === docId && n.page === number && !n.deleted,
                  ));
                  return (
                    <div key={number}>
                      <button
                        className={`tree-page ${page === number ? "active" : ""}`}
                        onClick={() => {
                          navigateSource(number);
                          setNotePage(number);
                          setNoteId(null);
                          setFollowPage(true);
                          if (window.innerWidth <= 1000) setTreeOpen(false);
                        }}
                      >
                        <span>{String(number).padStart(2, "0")}</span>
                        <span>第 {number} 页</span>
                        {notes.some((n) => n.kind === "ai") && <i />}
                      </button>
                      {notePage === number &&
                        notes.map((n) => (
                          <button
                            key={n.id}
                            className={`tree-note ${note?.id === n.id ? "active" : ""}`}
                            onClick={() => { setNotePage(number); setNoteId(n.id); setLayout('split'); if (window.innerWidth <= 1000) setTreeOpen(false); }}
                          >
                            {n.kind === "ai" ? (
                              <Sparkles size={13} />
                            ) : (
                              <PenLine size={13} />
                            )}
                            <span>{n.title}</span>
                          </button>
                        ))}
                    </div>
                  );
                })}
              </div>
              <div className="tree-bottom">
                <button onClick={() => { setDialog("newNote"); if (window.innerWidth <= 1000) setTreeOpen(false); }}>
                  <Plus size={15} /> 新增笔记页
                </button>
                <button onClick={exportNotes}>
                  <Download size={15} /> 导出笔记
                </button>
                <button
                  onClick={() => {
                    if (confirm("将这份资料移入回收站？"))
                      patchDoc(doc, { deleted: true });
                  }}
                >
                  <Trash2 size={15} /> 移入回收站
                </button>
              </div>
            </aside>
            <div className="workspace-main">
              <div className="work-toolbar">
                <div className="work-left">
                  {!treeOpen && (
                    <IconButton
                      title="展开页面导航"
                      onClick={() => setTreeOpen(true)}
                    >
                      <Menu size={19} />
                    </IconButton>
                  )}
                  <span
                    className="breadcrumb"
                    onClick={() => setScreen("library")}
                  >
                    资料库
                  </span>
                  <ChevronRight size={14} />
                  <h1 className="workspace-title">{doc.name}</h1>
                </div>
                <div className="layout-switch">
                  <button
                    className={layout === "doc" ? "active" : ""}
                    onClick={() => setLayout("doc")}
                    title="只看原文"
                  >
                    <FileText size={17} />
                    <span>原文</span>
                  </button>
                  <button
                    className={layout !== "doc" ? "active" : ""}
                    onClick={() => setLayout("split")}
                    title={layout === 'note' ? '还原笔记侧栏' : '打开笔记侧栏'}
                  >
                    <PenLine size={17} />
                    <span>笔记</span>
                  </button>
                </div>
              </div>
              <div ref={panelsRef} className="panels" style={{ '--note-width': `${visibleNoteWidth}px` }}>
                <section className="source-panel">
                  <div className="panel-toolbar">
                    <div className="panel-label">
                      <FileText size={16} /> 原文
                    </div>
                    <div className="page-controls">
                      <IconButton
                        title="上一页"
                        disabled={page <= 1}
                        onClick={() => {
                          navigateSource(page - 1);
                        }}
                      >
                        <ChevronLeft size={18} />
                      </IconButton>
                      <span>
                        {page} / {doc.pages}
                      </span>
                      <IconButton
                        title="下一页"
                        disabled={page >= doc.pages}
                        onClick={() => {
                          navigateSource(page + 1);
                        }}
                      >
                        <ChevronRight size={18} />
                      </IconButton>
                    </div>
                    <div className="zoom-controls">
                      <IconButton
                        title="缩小"
                        disabled={zoom <= 0.5}
                        onClick={() =>
                          setZoom(Math.max(0.5, +(zoom - 0.15).toFixed(2)))
                        }
                      >
                        <ZoomOut size={17} />
                      </IconButton>
                      <span>{Math.round(zoom * 100)}%</span>
                      <IconButton
                        title="放大"
                        disabled={zoom >= 2}
                        onClick={() =>
                          setZoom(Math.min(2, +(zoom + 0.15).toFixed(2)))
                        }
                      >
                        <ZoomIn size={17} />
                      </IconButton>
                    </div>
                    <IconButton title={followPage ? "关闭跟随翻页" : "开启跟随翻页"} className={followPage ? "follow-active" : ""} onClick={() => { setFollowPage(!followPage); if (!followPage) { setNotePage(page); setNoteId(null); } }}><Link2 size={16}/></IconButton>
                    <IconButton title={markupOpen ? '收起原文标记工具' : '打开原文标记工具'} className={markupOpen ? 'markup-toggle active' : ''} onClick={() => { setMarkupOpen(!markupOpen); setMarkupTool(null); }}><Paintbrush size={17}/></IconButton>
                    <button
                      className={`region-button ${regionMode ? "active" : ""}`}
                      title="在原文页面拖动创建框选"
                      onClick={() => {
                        const next = !regionMode;
                        if (next) {
                          setMarkupTool(null);
                          setEditingRegion(null);
                          setSelectedRect(null);
                          setHighlightRect(null);
                          setSelectedQuote("");
                          setSelectedRects([]);
                          setHoveredAnnotation(null);
                        }
                        setRegionMode(next);
                      }}
                    >
                      <Maximize2 size={14} /> 框选
                    </button>
                    <IconButton title={selectedQuote ? '关联选中文字到当前笔记' : selectedRect ? '关联框选区域到当前笔记' : '关联当前原文页到笔记'} onClick={() => linkCurrent(null)}><Link2 size={16} /></IconButton>
                    {editingRegion && <>
                      <IconButton title="保存框选调整" disabled={!selectedRect} onClick={saveRegionEdit}><Check size={17} /></IconButton>
                      <IconButton title="取消调整" onClick={cancelRegionEdit}><RotateCcw size={17} /></IconButton>
                    </>}
                    {selectedRect && <IconButton title={editingRegion ? "删除框选及关联" : "删除框选"} onClick={deleteRegionSelection}><Trash2 size={17} /></IconButton>}
                  </div>
                  {markupOpen && <div className="source-markup-toolbar" aria-label="原文标记工具">
                    {[
                      ['pen', '画笔', <Paintbrush size={17} />],
                      ['highlighter', '荧光笔', <Highlighter size={17} />],
                      ['eraser', '橡皮擦', <Eraser size={17} />],
                      ['sticky', '便利贴', <StickyNote size={17} />],
                    ].map(([tool, label, icon]) => <button key={tool} type="button" className={markupTool === tool ? 'active' : ''} title={label} aria-label={label} aria-pressed={markupTool === tool} onClick={() => { setMarkupTool(markupTool === tool ? null : tool); setRegionMode(false); setSelectedRect(null); setEditingRegion(null); }}>{icon}</button>)}
                    {markupTool === 'sticky' && <div className="sticky-placement-switch" role="group" aria-label="便利贴放置方式">
                      <button type="button" className={stickyPlacement === 'single' ? 'active' : ''} aria-pressed={stickyPlacement === 'single'} onClick={() => setStickyPlacement('single')}>单个</button>
                      <button type="button" className={stickyPlacement === 'multiple' ? 'active' : ''} aria-pressed={stickyPlacement === 'multiple'} onClick={() => setStickyPlacement('multiple')}>批量</button>
                    </div>}
                    <span className="markup-divider" />
                    {markupTool !== 'sticky' && <>
                      <input type="color" aria-label="标记颜色" title="标记颜色" value={markupColor} onChange={(event) => setMarkupColors((old) => ({ ...old, [markupTool === 'highlighter' ? 'highlighter' : 'pen']: event.target.value }))} />
                      <input type="range" min="1" max="10" aria-label="画笔粗细" title="画笔粗细" value={markupSize} onChange={(event) => setMarkupSize(Number(event.target.value))} />
                      <button type="button" title="撤销上一笔" aria-label="撤销上一笔" disabled={!pageMarkup.strokes.length} onClick={() => updatePageMarkup({ ...pageMarkup, strokes: pageMarkup.strokes.slice(0, -1) }, true)}><Undo2 size={17} /></button>
                    </>}
                    <button type="button" title={showStickies ? '隐藏便利贴为标记' : '显示未单独隐藏的便利贴'} aria-label={showStickies ? '隐藏便利贴为标记' : '显示未单独隐藏的便利贴'} aria-pressed={!showStickies} onClick={() => setShowStickies(!showStickies)}>{showStickies ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                    {markupTool !== 'sticky' && <button type="button" title="清除本页笔迹" aria-label="清除本页笔迹" disabled={!pageMarkup.strokes.length} onClick={() => { if (confirm('清除本页所有画笔标记？便利贴会保留。')) updatePageMarkup({ ...pageMarkup, strokes: [] }, true); }}><Trash2 size={17} /></button>}
                  </div>}
                  <div className="source-scroll">
                    <Suspense fallback={<div className="pdf-status">正在准备原文…</div>}>
                    <PdfPage
                      docId={doc.id}
                      page={page}
                      zoom={zoom}
                      onText={setSourcePage}
                      onTextSelection={(selection) => {
                        if (!selection?.quote) { setSelectedQuote(''); setSelectedRects([]); return; }
                        setSelectedQuote(selection.quote);
                        setSelectedRects(selection.rects);
                        setSelectedRect(null);
                        setEditingRegion(null);
                      }}
                      selectedQuote={selectedQuote}
                      regionMode={regionMode}
                      onRegion={(rect) => {
                        setSelectedRect(rect);
                        setSelectedRects([]);
                        setSelectedQuote("");
                        setRegionMode(false);
                        notify("已框选区域，可拖动边框调整后关联笔记");
                      }}
                      selectedRect={selectedRect}
                      onSelectedRectChange={setSelectedRect}
                      highlightRect={resolvedHighlightRect}
                      links={visibleLinks}
                      onAnnotationHover={showAnnotation}
                      onAnnotationLeave={() => setHoveredAnnotation(null)}
                      onAnnotationClick={focusAnnotation}
                      onCopyResult={(copied) => notify(copied ? '已复制选中的原文文字' : '复制失败，请检查浏览器剪贴板权限')}
                      markup={pageMarkup}
                      onMarkupChange={updatePageMarkup}
                      markupTool={markupTool}
                      onStickyPlaced={() => { if (stickyPlacement === 'single') setMarkupTool(null); }}
                      markupColor={markupColor}
                      markupSize={markupSize}
                      showStickies={showStickies}
                    />
                    </Suspense>
                  </div>
                </section>
                {layout === 'split' && <div
                  className="note-resizer"
                  role="separator"
                  tabIndex={0}
                  aria-label="调整笔记栏宽度"
                  aria-orientation="vertical"
                  aria-controls="note-panel"
                  aria-valuemin={noteLimits.min}
                  aria-valuemax={noteLimits.max}
                  aria-valuenow={visibleNoteWidth}
                  title="拖动调整笔记栏宽度"
                  onPointerDown={(event) => {
                    if (event.pointerType === 'mouse' && event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    noteResize.current = { pointerId: event.pointerId, width: visibleNoteWidth };
                  }}
                  onPointerMove={(event) => {
                    if (noteResize.current?.pointerId === event.pointerId) resizeNoteAt(event.clientX);
                  }}
                  onPointerUp={endNoteResize}
                  onPointerCancel={endNoteResize}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const step = event.shiftKey ? 40 : 16;
                    const next = event.key === 'Home' ? noteLimits.min : event.key === 'End' ? noteLimits.max
                      : visibleNoteWidth + (event.key === 'ArrowLeft' ? step : -step);
                    setNoteWidth(clampNoteWidth(next, panelWidth, overlayNotes));
                  }}
                ><GripVertical size={14} /></div>}
                <section id="note-panel" className="note-panel">
                  <div className="panel-toolbar">
                    <div className="panel-label">
                      <PenLine size={16} /> 笔记
                    </div>
                    <div className="note-panel-actions">
                    <select
                      aria-label="当前笔记页"
                      value={note?.id || ""}
                      onChange={(e) => setNoteId(e.target.value)}
                    >
                      <option value="" disabled>
                        {note ? "选择笔记" : "还没有笔记"}
                      </option>
                      {pageNotes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.title}
                        </option>
                      ))}
                    </select>
                    <IconButton
                      title="新增笔记页"
                      onClick={() => setDialog("newNote")}
                    >
                      <Plus size={18} />
                    </IconButton>
                    {note && (
                      <div className="note-more">
                        <IconButton title="笔记页上移" disabled={pageNotes.findIndex((item) => item.id === note.id) <= 0} onClick={() => moveNote(-1)}><ChevronDown className="rotate-up" size={16}/></IconButton>
                        <IconButton title="笔记页下移" disabled={pageNotes.findIndex((item) => item.id === note.id) >= pageNotes.length - 1} onClick={() => moveNote(1)}><ChevronDown size={16}/></IconButton>
                        <IconButton
                          title="复制笔记页"
                          onClick={() => duplicateNote(note)}
                        >
                          <MoreHorizontal size={18} />
                        </IconButton>
                        <IconButton
                          title="删除笔记页"
                          onClick={() => removeNote(note)}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </div>
                    )}
                    <IconButton
                      title={layout === 'note' ? '还原笔记侧栏' : '最大化笔记'}
                      onClick={() => setLayout(layout === 'note' ? 'split' : 'note')}
                    >{layout === 'note' ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</IconButton>
                    <IconButton title="关闭笔记侧栏" onClick={() => setLayout('doc')}><PanelRightClose size={17} /></IconButton>
                    </div>
                  </div>
                  <div className="note-scroll">
                    {note ? (
                      <NoteEditor
                        key={note.id}
                        note={note}
                        update={updateNote}
                        addLink={linkCurrent}
                        onJump={jump}
                        onEditRegion={editRegion}
                        onRemoveLink={(linkId) => { if (editingRegion?.linkId === linkId) cancelRegionEdit(); }}
                        saveStatus={saveStatus[note.id]}
                        editingLinkId={editingLinkId}
                        setEditingLinkId={setEditingLinkId}
                      />
                    ) : (
                      <div className="note-empty">
                        <PenLine size={28} />
                        <h2>这一页还没有笔记</h2>
                        <p>可新建自己的笔记页，或连接模型生成学习笔记。</p>
                        <button
                          className="primary-button"
                          onClick={() => setDialog("newNote")}
                        >
                          <Plus size={16} /> 新建笔记页
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </main>
        )}
        {screen === "models" && (
          <main className="settings-page">
            <div className="page-head">
              <div>
                <span className="eyebrow">SETTINGS</span>
                <h1>模型连接</h1>
                <p>连接支持 Chat Completions 的模型接口。调用费用由服务商收取。</p>
              </div>
            </div>
            <div className="settings-grid">
              <section className="settings-list">
                <h2>已保存的连接</h2>
                {models.length ? (
                  models.map((item, index) => (
                    <button
                      key={item.id}
                      className={
                        activeModel?.id === item.id
                          ? "model-row active"
                          : "model-row"
                      }
                      onClick={() => { setModelId(item.id); setModelTestResult(null); setEditingModel(null); }}
                    >
                      <span className="model-avatar">
                        <Sparkles size={18} />
                      </span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {index + 1}. {item.model} · {item.vision ? "支持图片" : "文字模型"}
                        </small>
                      </span>
                      {keys[item.id] && <Check size={16} />}
                    </button>
                  ))
                ) : (
                  <div className="muted">尚未添加模型连接。</div>
                )}
                {activeModel && (
                  <div className="unlock-panel">
                    <h3>{activeModel.name}</h3>
                    <p>{activeModel.endpoint}</p>
                    {isDeepSeekEndpoint(activeModel.endpoint) && <p className="model-provider-hint">DeepSeek Flash 的 API 模型 ID 为 <code>deepseek-flash</code>；<code>DeepSeek-V4.1-Flash-1017</code> 是版本名称。</p>}
                    {selectedKey ? (
                      <>
                        <div className="success-line">
                          <Check size={16} /> 本次使用已解锁
                        </div>
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={testModel}
                        >
                          测试连接与格式
                        </button>
                        {modelTestResult?.id === activeModel.id && <p className={`model-test-result ${modelTestResult.type}`} role="status">{modelTestResult.message}</p>}
                        {editingModel?.id === activeModel.id ? (
                          <form className="model-id-editor" onSubmit={saveModelId}>
                            <label htmlFor="saved-model-id">模型 ID</label>
                            <input id="saved-model-id" value={editingModel.model} onChange={(event) => setEditingModel({ ...editingModel, model: event.target.value })} required />
                            <div><button className="secondary-button" type="submit">保存</button><button className="text-button" type="button" onClick={() => setEditingModel(null)}>取消</button></div>
                          </form>
                        ) : <button className="text-button" type="button" onClick={() => setEditingModel({ id: activeModel.id, model: activeModel.model })}>修改模型 ID</button>}
                        <button
                          className="danger-button"
                          onClick={() => {
                            if (confirm("删除此模型连接和加密密钥？")) {
                              setModels(
                                models.filter((x) => x.id !== activeModel.id),
                              );
                              const next = { ...keys };
                              delete next[activeModel.id];
                              setKeys(next);
                              setModelId(null);
                              setModelTestResult(null);
                              setEditingModel(null);
                            }
                          }}
                        >
                          删除连接
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          aria-label="解锁口令"
                          type="password"
                          placeholder="输入保护口令"
                          value={unlockPhrase}
                          onChange={(e) => setUnlockPhrase(e.target.value)}
                        />
                        <button
                          className="secondary-button"
                          onClick={unlockModel}
                        >
                          解锁连接
                        </button>
                      </>
                    )}
                  </div>
                )}
              </section>
              <section className="settings-form">
                <h2>添加模型连接</h2>
                <form onSubmit={saveModel}>
                  <label>
                    连接名称
                    <input
                      value={modelForm.name}
                      placeholder="例如：我的学习模型"
                      onChange={(e) =>
                        setModelForm({ ...modelForm, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    预设模型
                    <select
                      value={modelPreset}
                      onChange={(e) => {
                        const preset = e.target.value;
                        setModelPreset(preset);
                        if (preset) setModelForm((current) => applyModelPreset(current, preset));
                      }}
                    >
                      <option value="">手动填写模型</option>
                      {modelProviders.map((provider) => (
                        <optgroup key={provider.name} label={provider.name}>
                          {provider.models.map((item) => (
                            <option key={item.id} value={`${provider.name}:${item.id}`}>
                              {item.id}{item.vision ? ' · 支持图片' : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label>
                    模型名称
                    <input
                      required
                      value={modelForm.model}
                      placeholder="服务商提供的模型 ID"
                      onChange={(e) => {
                        setModelPreset('');
                        setModelForm((current) => ({ ...current, model: e.target.value }));
                      }}
                    />
                  </label>
                  <label>
                    接口地址
                    <input
                      type="url"
                      required
                      value={modelForm.endpoint}
                      placeholder="选择预设模型后自动填写，或自行输入"
                      onChange={(e) => {
                        setModelPreset('');
                        setModelForm((current) => ({ ...current, endpoint: e.target.value }));
                      }}
                    />
                  </label>
                  {isDeepSeekEndpoint(modelForm.endpoint) && <p className="model-provider-hint">DeepSeek Flash 请填写 API 模型 ID <code>deepseek-flash</code>，不要填写模型版本名称。</p>}
                  <label>
                    API 密钥
                    <input
                      type="password"
                      required
                      autoComplete="off"
                      value={modelForm.key}
                      onChange={(e) =>
                        setModelForm({ ...modelForm, key: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    保护口令
                    <input
                      type="password"
                      required
                      minLength="8"
                      placeholder="至少 8 个字符，用于加密本机密钥"
                      value={modelForm.passphrase}
                      onChange={(e) =>
                        setModelForm({
                          ...modelForm,
                          passphrase: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={modelForm.vision}
                      onChange={(e) =>
                        setModelForm({ ...modelForm, vision: e.target.checked })
                      }
                    />{" "}
                    模型可处理页面图片
                  </label>
                  <p className="field-note">
                    接口需兼容 OpenAI Chat Completions；预设型号是否可用以服务商账户为准。密钥加密保存在当前浏览器，关闭后用保护口令解锁。测试连接可能产生少量费用。
                  </p>
                  <button className="primary-button" type="submit">
                    <Plus size={16} /> 保存连接
                  </button>
                </form>
              </section>
            </div>
          </main>
        )}
        {screen === "templates" && (
          <Templates data={data} reload={reload} notify={notify} />
        )}
        {screen === "trash" && (
          <main className="settings-page">
            <div className="page-head">
              <div>
                <span className="eyebrow">LIBRARY</span>
                <h1>回收站</h1>
                <p>恢复误删的资料或笔记。</p>
              </div>
            </div>
            <div className="trash-list">
              {data.docs
                .filter((x) => x.deleted)
                .map((item) => (
                  <div key={item.id}>
                    <FileText size={18} />
                    <span>{item.name}</span>
                    <button onClick={() => patchDoc(item, { deleted: false })}>
                      恢复资料
                    </button>
                  </div>
                ))}
              {data.notes
                .filter((x) => x.deleted)
                .map((item) => (
                  <div key={item.id}>
                    <PenLine size={18} />
                    <span>
                      {item.title} · 第 {item.page} 页
                    </span>
                    <button
                      onClick={async () => {
                        await api(
                          `/notes/${item.id}`,
                          json("PUT", { deleted: false }),
                        );
                        await reload();
                      }}
                    >
                      恢复笔记
                    </button>
                  </div>
                ))}
              {!data.docs.some((x) => x.deleted) &&
                !data.notes.some((x) => x.deleted) && (
                  <div className="library-empty">
                    <Trash2 size={28} />
                    <h2>回收站是空的</h2>
                  </div>
                )}
            </div>
          </main>
        )}
      </div>
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && (!busy || dialog === 'generate')) {
              setDialog(null);
              setPreview(null);
            }
          }}
        >
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h2>
                {dialog === "import"
                  ? "导入学习资料"
                  : dialog === "newNote"
                    ? "新建笔记页"
                    : "生成学习笔记"}
              </h2>
              <IconButton
                title="关闭"
                onClick={() => {
                  if (!busy || dialog === 'generate') {
                    setDialog(null);
                    setPreview(null);
                  }
                }}
              >
                <X size={19} />
              </IconButton>
            </div>
            {dialog === "import" && (
              <form onSubmit={importFile}>
                <label className="file-drop">
                  <Upload size={30} />
                  <strong>{file?.name || (window.YuanOfflineApp ? '选择 PDF 文件' : '选择 PDF、PPT 或 Word 文件')}</strong>
                  <span>{window.YuanOfflineApp ? '离线导入 PDF，最大 100 MB；Word/PPT 请先转成 PDF' : '最大 100 MB；PPT 和 Word 将转换为 PDF 预览'}</span>
                  <input
                    type="file"
                    accept={window.YuanOfflineApp ? '.pdf,application/pdf' : '.pdf,.ppt,.pptx,.doc,.docx'}
                    onChange={(e) => setFile(e.target.files?.[0])}
                  />
                </label>
                <label>
                  课程名称（可选）
                  <input
                    value={course}
                    onChange={(e) => setCourse(e.target.value)}
                    placeholder="例如：高等数学"
                  />
                </label>
                <div className="modal-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setDialog(null)}
                  >
                    取消
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy}
                    type="submit"
                  >
                    {busy ? "正在处理…" : "导入资料"}
                  </button>
                </div>
              </form>
            )}
            {dialog === "newNote" && (
              <div>
                <p className="muted">新笔记将归在第 {notePage} 页下；可继续链接其他原文页。</p>
                <div className="template-choices">
                  {[defaultTemplate, ...data.templates].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        createNote(item);
                        setDialog(null);
                      }}
                    >
                      <BookOpen size={18} />
                      <strong>{item.name}</strong>
                      <small>
                        {item.sections.length
                          ? item.sections.join(" · ")
                          : "空白页面"}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {dialog === "generate" && (
              <div className="generate-form">
                {preview ? (
                  <>
                    <p className="muted">
                      第 {preview.page}{" "}
                      页的新草稿已准备好。确认后替换智能笔记正文；个人补充和链接继续保留。
                    </p>
                    <div className="compare-grid">
                      <div>
                        <strong>原有内容</strong>
                        {aiNoteSections(preview.previous).map(({ key, title, value }) => (
                            <section key={key}>
                              <h3>{title}</h3>
                              <p>
                                {Array.isArray(value) ? value.join("；") : value}
                              </p>
                            </section>
                        ))}
                      </div>
                      <div>
                        <strong>新草稿</strong>
                        {aiNoteSections(preview.ai).map(({ key, title, value }) => (
                            <section key={key}>
                              <h3>{title}</h3>
                              <p>
                                {Array.isArray(value) ? value.join("；") : value}
                              </p>
                            </section>
                        ))}
                      </div>
                    </div>
                    <div className="modal-actions">
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setPreview(null);
                          setDialog(null);
                        }}
                      >
                        保留原内容
                      </button>
                      <button
                        className="primary-button"
                        onClick={acceptPreview}
                      >
                        确认替换
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label>
                      生成范围
                      <select
                        value={range}
                        onChange={(e) => setRange(e.target.value)}
                      >
                        <option value="current">当前页 · 第 {page} 页</option>
                        <option value="custom">指定页</option>
                        <option value="all">整份文档 · {doc?.pages} 页</option>
                      </select>
                    </label>
                    {range === "custom" && (
                      <label>
                        页码
                        <input
                          value={rangeText}
                          onChange={(e) => setRangeText(e.target.value)}
                          placeholder="例如：1-3,5"
                        />
                      </label>
                    )}
                    <div className="ai-outline-editor">
                      <strong>智能笔记模板</strong>
                      <div className="ai-preset-switch" role="group" aria-label="智能笔记模板">
                        {Object.entries(aiNotePresets).map(([key, preset]) => (
                          <button key={key} type="button" className={aiOutline.preset === key ? 'active' : ''} disabled={busy}
                            onClick={() => setAiOutline((current) => ({ ...current, preset: key, titles: [...preset.titles] }))}>{preset.name}</button>
                        ))}
                      </div>
                      <div className="ai-outline-head"><span>生成标题与顺序</span><span>{aiOutline.titles.length} / 12</span></div>
                      <div className="ai-outline-list">
                        {aiOutline.titles.map((title, index) => (
                          <div className="ai-outline-row" key={index}>
                            <span>{index + 1}</span>
                            <input aria-label={`第 ${index + 1} 个笔记标题`} maxLength={60} value={title} disabled={busy}
                              onChange={(event) => setAiOutline((current) => ({ ...current, titles: current.titles.map((item, position) => position === index ? event.target.value : item) }))} />
                            <IconButton title={`上移第 ${index + 1} 个标题`} disabled={busy || index === 0}
                              onClick={() => setAiOutline((current) => { const titles = [...current.titles]; [titles[index - 1], titles[index]] = [titles[index], titles[index - 1]]; return { ...current, titles }; })}><ChevronUp size={16} /></IconButton>
                            <IconButton title={`下移第 ${index + 1} 个标题`} disabled={busy || index === aiOutline.titles.length - 1}
                              onClick={() => setAiOutline((current) => { const titles = [...current.titles]; [titles[index + 1], titles[index]] = [titles[index], titles[index + 1]]; return { ...current, titles }; })}><ChevronDown size={16} /></IconButton>
                            <IconButton title={`删除第 ${index + 1} 个标题`} disabled={busy || aiOutline.titles.length <= 1}
                              onClick={() => setAiOutline((current) => ({ ...current, titles: current.titles.filter((_, position) => position !== index) }))}><Trash2 size={16} /></IconButton>
                          </div>
                        ))}
                      </div>
                      <button type="button" className="secondary-button ai-outline-add" disabled={busy || aiOutline.titles.length >= 12}
                        onClick={() => setAiOutline((current) => ({ ...current, titles: [...current.titles, ''] }))}><Plus size={15} /> 添加标题</button>
                    </div>
                    <label className="ai-guidance">
                      补充生成要求（可选）
                      <textarea value={aiOutline.guidance} maxLength={1000} rows={3} disabled={busy}
                        placeholder="例如：重点解释方法推导，简述研究背景"
                        onChange={(event) => setAiOutline((current) => ({ ...current, guidance: event.target.value }))} />
                    </label>
                    <label>
                      使用已保存的模型连接
                      <select
                        value={activeModel?.id || ""}
                        onChange={(e) => {
                          setModelId(e.target.value);
                          setUnlockPhrase('');
                        }}
                      >
                        <option value="" disabled>
                          请选择模型
                        </option>
                        {models.map((item, index) => (
                          <option key={item.id} value={item.id}>
                            {index + 1}. {item.name} · {item.model} · {item.vision ? '图片' : '文字'} · {keys[item.id] ? '已解锁' : '需解锁'}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!activeModel ? (
                      <div className="notice">
                        尚未添加模型连接。
                        <button
                          onClick={() => {
                            setDialog(null);
                            setScreen("models");
                          }}
                        >
                          前往配置
                        </button>
                      </div>
                    ) : !selectedKey ? (
                      <div className="notice generation-model-lock">
                        <strong>{activeModel.name} · {activeModel.model}</strong>
                        <label>
                          保护口令
                          <input
                            type="password"
                            autoComplete="off"
                            value={unlockPhrase}
                            onChange={(e) => setUnlockPhrase(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                unlockModel();
                              }
                            }}
                          />
                        </label>
                        <button className="secondary-button" type="button" onClick={unlockModel}>
                          解锁并使用
                        </button>
                      </div>
                    ) : (
                      <div className="notice">
                        将发送所选页面的文字
                        {activeModel.vision ? "及页面图片" : ""}至{" "}
                        {activeModel.name}。调用可能产生费用，请核对服务商账单。
                      </div>
                    )}
                    {progress && (
                      <div className="task-progress">
                        <div>
                          <strong>处理进度</strong>
                          <span>
                            已处理 {progress.done} / {progress.total}
                          </span>
                        </div>
                        <progress value={progress.done} max={progress.total} />
                        <small>
                          {busy
                            ? `正在处理第 ${progress.page} 页`
                            : progress.errors.length
                              ? `处理结束，${progress.errors.length} 页未生成`
                              : "全部生成完成"}
                        </small>
                        {progress.errors.map((message, index) => (
                          <p key={index} className="error-line">
                            {message}
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="modal-actions">
                      <button
                        className="secondary-button"
                        onClick={() =>
                          busy ? (stopRef.current = true) : setDialog(null)
                        }
                      >
                        {busy ? "完成当前页后停止" : "关闭"}
                      </button>
                      <button
                        className="primary-button"
                        disabled={busy || !selectedKey}
                        onClick={runGeneration}
                      >
                        <Sparkles size={15} />{" "}
                        {progress && !busy ? "重新运行" : "开始生成"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <AnnotationTooltip link={hoveredLink} position={hoveredAnnotation} />
    </div>
  );
}

function Templates({ data, reload, notify }) {
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState("");
  const [sections, setSections] = useState(["课堂重点", "我的疑问"]);
  const [style, setStyle] = useState({ accent: '#176d72', paper: 'plain' });
  function choose(item) {
    setSelected(item?.id || null);
    setName(item?.name || "");
    setSections(item?.sections || ["课堂重点", "我的疑问"]);
    setStyle(item?.style || { accent: '#176d72', paper: 'plain' });
  }
  async function save() {
    try {
      if (!name.trim()) throw new Error("请输入模板名称");
      if (selected)
        await api(`/templates/${selected}`, json("PUT", { name, sections, style }));
      else await api("/templates", json("POST", { name, sections, style }));
      await reload();
      notify("模板已保存");
      choose(null);
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <main className="settings-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">PERSONALIZE</span>
          <h1>笔记模板</h1>
          <p>为不同课程准备合适的记录结构。</p>
        </div>
        <button className="primary-button" onClick={() => choose(null)}>
          <Plus size={16} /> 新建模板
        </button>
      </div>
      <div className="settings-grid">
        <section className="settings-list">
          <h2>我的模板</h2>
          {data.templates.map((item) => (
            <button
              className={
                selected === item.id ? "model-row active" : "model-row"
              }
              key={item.id}
              onClick={() => choose(item)}
            >
              <BookOpen size={18} />
              <span>
                <strong>{item.name}</strong>
                <small>{item.sections.length} 个区块</small>
              </span>
            </button>
          ))}
          {!data.templates.length && <p className="muted">尚无自定义模板。</p>}
        </section>
        <section className="settings-form">
          <h2>{selected ? "编辑模板" : "创建模板"}</h2>
          <label>
            模板名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：数学推导"
            />
          </label>
          <div className="template-fields">
            <strong>页面区块</strong>
            {sections.map((field, index) => (
              <div key={index}>
                <input
                  aria-label={`区块 ${index + 1}`}
                  value={field}
                  onChange={(e) =>
                    setSections(
                      sections.map((x, i) =>
                        i === index ? e.target.value : x,
                      ),
                    )
                  }
                />
                <IconButton
                  title="上移区块"
                  disabled={!index}
                  onClick={() => {
                    const next = [...sections];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    setSections(next);
                  }}
                >
                  <ChevronDown size={15} className="rotate-up" />
                </IconButton>
                <IconButton
                  title="删除区块"
                  onClick={() =>
                    setSections(sections.filter((_, i) => i !== index))
                  }
                >
                  <X size={15} />
                </IconButton>
              </div>
            ))}
            <button
              className="text-button"
              onClick={() => setSections([...sections, "新区块"])}
            >
              <Plus size={15} /> 添加区块
            </button>
          </div>
          <div className="template-style"><strong>强调颜色</strong><div className="swatches">{['#176d72', '#b76742', '#516f91', '#698451', '#a15768'].map((color) => <button key={color} className={style.accent === color ? 'active' : ''} style={{ background: color }} aria-label={`选择颜色 ${color}`} title={color} onClick={() => setStyle({ ...style, accent: color })}/>)}</div><label>页面背景<select value={style.paper} onChange={(e) => setStyle({ ...style, paper: e.target.value })}><option value="plain">空白</option><option value="lined">横线</option><option value="grid">方格</option></select></label></div>
          <div className={`template-preview paper-${style.paper}`} style={{ '--note-accent': style.accent }}><strong>{name || '模板名称'}</strong>{sections.map((field, index) => <div key={index}><span>{field || `区块 ${index + 1}`}</span><p>在这里记录学习内容</p></div>)}</div>
          <div className="modal-actions">
            <button className="primary-button" onClick={save}>
              保存模板
            </button>
            {selected && (
              <button
                className="danger-button"
                onClick={async () => {
                  if (!confirm("删除这个模板？已有笔记不受影响。")) return;
                  await api(`/templates/${selected}`, { method: "DELETE" });
                  await reload();
                  choose(null);
                }}
              >
                删除模板
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
