import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Square, X, Paperclip, Plus, Check, LoaderCircle, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { api, json } from './api';
import { assistantContext } from './assistantTools';
import { runAssistantTask } from './assistantRunner';
import { modelOnline } from './offlineModel';
import { offlineBackup } from './offlineStore';
import { uploadNoteImage } from './noteImages';
import './assistant.css';

const examples = ['帮我把论文整理到一个新文件夹', '总结当前页，并添加一份复习笔记', '根据当前页制作思维导图', '在当前页放一张提醒复习的便利贴'];
const message = (type, text, extra = {}) => ({ id: crypto.randomUUID(), type, text, ...extra });

export default function AssistantPanel({ open, onClose, models, modelId, setModelId, model, apiKey, unlock, context, flush, reload, navigate, feature, view, externallyBusy }) {
  const [events, setEvents] = useState([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [phrase, setPhrase] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState('');
  const [canResume, setCanResume] = useState(false);
  const suspended = useRef(null);
  const controller = useRef(null);
  const confirmation = useRef(null);
  const memory = useRef([]);
  const images = useRef(new Map());
  const noteHistory = useRef(new Map());
  const previews = useRef(new Map());
  const latest = useRef(null);
  latest.current = { context, model, apiKey, reload, navigate, feature, view };
  const end = useRef(null);
  const attachmentInput = useRef(null);
  const active = useRef(false);

  function emit(event) {
    setEvents(old => event.id && old.some(item => item.id === event.id)
      ? old.map(item => item.id === event.id ? event : item)
      : [...old, event.id ? event : message(event.type, event.text, event)]);
  }
  function stop() { controller.current?.abort(); confirmation.current?.(false); confirmation.current = null; setPending(null); }
  useEffect(() => () => { controller.current?.abort(); confirmation.current?.(false); }, []);
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'nearest' }); }, [events, pending, open]);

  function publicData(data) {
    function visit(value) {
      if (typeof value === 'string' && value.startsWith('data:image/')) {
        for (const [id, source] of images.current) if (source === value) return id;
        const id = `image:${crypto.randomUUID()}`; images.current.set(id, value); return id;
      }
      if (Array.isArray(value)) return value.map(visit);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
      return value;
    }
    return visit(data);
  }
  function decide(value) {
    const resolve = confirmation.current; confirmation.current = null; setPending(null); resolve?.(value);
  }
  async function send(event, resuming = false) {
    event.preventDefault();
    if (active.current || uploading || externallyBusy) return;
    const command = resuming ? suspended.current?.command : input.trim();
    if (!command || command.length > 4000) return setError('请输入1到4000字的指令');
    if (!modelOnline()) return setError('智能助手需要联网，请联网后重试');
    if (!model || !apiKey) return setError('请先选择并解锁一个模型连接');
    active.current = true; setRunning(true); setError(''); setInput('');
    const abort = new AbortController(); controller.current = abort;
    const selected = { endpoint: model.endpoint, model: model.model, key: apiKey, vision: model.vision };
    const currentAttachments = resuming ? suspended.current.attachments : [...attachments];
    const resumeState = resuming ? suspended.current.state : null;
    setAttachments([]); setCanResume(false);
    if (!resuming) suspended.current = { command, attachments: currentAttachments, state: null };
    if (resuming) emit(message('status', '从上次进度继续，已完成的操作不会重复提交。'));
    else emit(message('user', command, { attachments: currentAttachments }));
    try {
      await flush(); abort.signal.throwIfAborted();
      const result = await runAssistantTask({
        state: resumeState,
        onCheckpoint: state => { suspended.current = { command, attachments: currentAttachments, state }; },
        history: [...memory.current.slice(-8), { role: 'user', content: command }],
        context: async () => publicData(assistantContext(await api('/state'), latest.current.context, currentAttachments)),
        ask: ({ history, context }) => api('/assistant/turn', { ...json('POST', { ...selected, history, context }), signal: abort.signal }),
        env: {
          api, signal: abort.signal, model: selected, images: images.current, previews: previews.current, publicData, beforeStep: flush,
          get current() { return latest.current.context; }, view: args => latest.current.view(args),
          copy: text => emit(message('copy', text)),
          recordNoteHistory: (before, after) => {
            const history = noteHistory.current.get(before.id) || { past: [], future: [] };
            history.past.push({ before, after }); history.future = []; noteHistory.current.set(before.id, history);
          },
          navigate: args => latest.current.navigate(args), feature: async args => {
            const history = noteHistory.current.get(args.noteId || latest.current.context.noteId);
            if (['undo', 'redo'].includes(args.feature) && history) {
              const source = args.feature === 'undo' ? history.past : history.future;
              const target = args.feature === 'undo' ? history.future : history.past;
              const entry = source.at(-1);
              if (entry) {
                const expected = args.feature === 'undo' ? entry.after : entry.before;
                const replacement = args.feature === 'undo' ? entry.before : entry.after;
                const current = (await api('/state')).notes.find(note => note.id === expected.id);
                const relevant = note => JSON.stringify([note?.title, note?.ai, note?.blocks, note?.links, note?.style, note?.deleted]);
                if (relevant(current) !== relevant(expected)) throw new Error('笔记之后又发生了修改，无法自动撤销，请先读取当前内容');
                const changes = Object.fromEntries(['title', 'ai', 'blocks', 'links', 'style', 'deleted'].filter(field => field in replacement).map(field => [field, replacement[field]]));
                await api(`/notes/${expected.id}`, json('PUT', changes));
                source.pop(); target.push(entry);
                return { ok: true, message: args.feature === 'undo' ? '已撤销助手对笔记的上一次修改' : '已重做助手对笔记的上一次修改' };
              }
            }
            return latest.current.feature(args);
          },
          download: (kind, doc, options) => emit(message('download', kind === 'notes' ? `下载《${doc.name}》的笔记` : kind === 'mindmap' ? `下载思维导图（${options.format.toUpperCase()}）` : '下载资料库备份', { kind, doc, options })),
          progress: text => emit(message('status', text)),
        },
        confirm: value => new Promise(resolve => { confirmation.current = resolve; setPending(value); }),
        emit,
        refresh: () => latest.current.reload(),
      });
      memory.current.push({ role: 'user', content: command }, { role: 'assistant', content: JSON.stringify({ reply: result.reply, executed: result.observations.map(item => ({ tool: item.tool, ok: item.ok, ...(item.ok ? {} : { error: item.error }) })) }) });
      if (result.paused) setCanResume(true);
      else suspended.current = null;
    } catch (failure) {
      const text = abort.signal.aborted ? '已停止。已完成的操作保留；尚未执行的步骤已取消。' : failure.message;
      emit(message('error', text));
      setCanResume(!!suspended.current?.state);
      memory.current.push({ role: 'user', content: command }, { role: 'assistant', content: text + '。如需继续，请先查找并检查当前资料状态，不要重复写入。' });
      await latest.current.reload().catch(() => {});
    } finally {
      active.current = false; setRunning(false); setPending(null); controller.current = null; confirmation.current = null;
    }
  }
  async function uploadFiles(event) {
    const files = [...event.target.files]; event.target.value = '';
    if (!files.length || active.current) return;
    setUploading(true); setError('');
    try {
      await flush();
      const added = [];
      for (const file of files) {
        try {
          if (file.type.startsWith('image/')) {
            const { url } = await uploadNoteImage(file);
            const ref = url.startsWith('data:') ? `image:${crypto.randomUUID()}` : url;
            images.current.set(ref, url); added.push({ name: file.name, type: 'image', source: ref });
          } else {
            const form = new FormData(); form.append('file', file);
            const doc = await api('/docs', { method: 'POST', body: form });
            added.push({ name: file.name, type: 'document', docId: doc.id, pages: doc.pages });
          }
        } catch (failure) { emit(message('error', `${file.name}：${failure.message}`)); }
      }
      setAttachments(old => [...old, ...added].slice(-20));
      await reload();
    } catch (failure) { setError(failure.message); }
    finally { setUploading(false); }
  }
  async function download(item) {
    try {
      await flush();
      if (item.kind === 'notes') {
        const { exportDocument } = await import('./export');
        const state = await api('/state');
        const doc = state.docs.find(doc => doc.id === item.doc.id && !doc.deleted);
        if (!doc) throw new Error('资料不存在或已移入回收站');
        await exportDocument(doc, state.notes.filter(note => !note.deleted));
      } else if (item.kind === 'mindmap') {
        const state = await api('/state');
        const note = state.notes.find(note => note.id === item.options.noteId && !note.deleted);
        if (!note || !state.docs.some(doc => doc.id === note.docId && !doc.deleted)) throw new Error('笔记不存在或已移入回收站');
        const block = note.blocks.find(block => block.id === item.options.blockId && block.type === 'mindmap');
        if (!block) throw new Error('导图区块已不存在');
        const { exportMindMap } = await import('./mindMapExport'); await exportMindMap(block, item.options.format);
      } else if (window.YuanOfflineApp) await offlineBackup();
      else { const link = document.createElement('a'); link.href = '/api/backup'; link.download = ''; link.click(); }
    } catch (failure) { setError(failure.message); }
  }
  return <aside hidden={!open} className="assistant-panel" role="dialog" aria-label="智能助手">
    <header className="assistant-header"><div><Bot size={22}/><strong>智能助手</strong></div><div>
      <button type="button" title="新建对话" aria-label="新建对话" disabled={running || uploading} onClick={() => { setEvents([]); memory.current = []; images.current.clear(); setAttachments([]); setError(''); suspended.current = null; setCanResume(false); }}><Plus size={19}/></button>
      <button type="button" title="关闭智能助手" aria-label="关闭智能助手" onClick={() => { stop(); onClose(); }}><X size={19}/></button>
    </div></header>
    <div className="assistant-model">
      <label htmlFor="assistant-model">使用模型</label>
      <select id="assistant-model" value={modelId || model?.id || ''} disabled={running || uploading} onChange={event => setModelId(event.target.value)}>
        {!models.length && <option value="">尚未配置模型</option>}
        {models.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}
      </select>
      {model && !apiKey && <form className="assistant-unlock" onSubmit={async event => { event.preventDefault(); setUnlocking(true); setError(''); try { await unlock(phrase); setPhrase(''); } catch (failure) { setError(failure.message); } finally { setUnlocking(false); } }}>
        <input type="password" aria-label="助手模型保护口令" placeholder="输入保护口令解锁" value={phrase} onChange={event => setPhrase(event.target.value)} autoComplete="off" disabled={running || unlocking}/>
        <button className="secondary-button" disabled={!phrase || running || unlocking}>解锁</button>
      </form>}
      {!model && <button type="button" className="text-button" onClick={() => feature({ feature: 'models' })}>添加模型连接</button>}
      <p>{context.docName ? `当前资料：${context.docName} · 第${context.page}页` : '可操作整个资料库，也可先打开一份资料。'}</p>
    </div>
    <div className="assistant-conversation" aria-live="polite" aria-busy={running}>
      {!events.length && <div className="assistant-welcome"><Bot size={36}/><h2>说出你想完成的事</h2><p>我会查找资料、阅读原文并调用笔记功能，逐步告诉你执行结果。</p><div className="assistant-examples">{examples.map(text => <button type="button" key={text} onClick={() => setInput(text)}>{text}</button>)}</div><p className="assistant-privacy">指令、资料目录和任务中读取的正文会发送给所选模型。API 密钥仅用于连接该服务商，不加入对话。</p></div>}
      {events.map(item => item.type === 'action' ? <div className={`assistant-action ${item.status}`} key={item.id}>
        <span>{item.status === 'running' ? <LoaderCircle size={15}/> : item.status === 'done' ? <Check size={15}/> : <X size={15}/>} {item.text} · {item.status === 'running' ? '执行中' : item.status === 'done' ? '已执行' : item.status === 'stopped' ? '已停止' : '未完成'}</span>
        {item.detail && <details><summary>查看结果</summary><pre>{typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail, null, 2)}</pre></details>}
      </div> : item.type === 'download' ? <button className="secondary-button assistant-download" type="button" key={item.id} onClick={() => download(item)} disabled={running}><Download size={16}/>{item.text}</button>
        : item.type === 'copy' ? <button className="secondary-button assistant-download" type="button" key={item.id} onClick={async () => { try { await navigator.clipboard.writeText(item.text); emit(message('status', '已复制文字')); } catch { setError('复制失败，请检查剪贴板权限'); } }}>复制文字</button>
        : <div key={item.id} className={`assistant-message ${item.type}`}><small>{item.type === 'user' ? '你' : item.type === 'assistant' ? '智能助手' : item.type === 'error' ? '提示' : '进度'}</small>
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{item.text}</ReactMarkdown>
          {item.attachments?.map(attachment => <span className="assistant-attachment" key={attachment.source || attachment.docId}>{attachment.name}</span>)}
        </div>)}
      {pending && <div className="assistant-confirm" role="alertdialog" aria-label="确认助手操作"><strong>请确认这项操作</strong><p>{pending.label}</p><details open={!!pending.comparison}><summary>查看将修改的内容</summary><pre>{JSON.stringify(pending.comparison || pending.tool.args, null, 2)}</pre></details><div><button type="button" className="secondary-button" onClick={() => decide(false)}>取消本次任务</button><button type="button" className="primary-button" onClick={() => decide(true)}>确认执行</button></div></div>}
      {running && !pending && <p className="assistant-thinking" role="status">正在处理，可随时停止…</p>}
      <div ref={end}/>
    </div>
    <form className="assistant-composer" onSubmit={send}>
      {!!attachments.length && <div className="assistant-attachments">{attachments.map((item, index) => <span className="assistant-attachment" key={index}>{item.name}<button type="button" aria-label={`移除附件${item.name}`} onClick={() => setAttachments(old => old.filter((_, position) => position !== index))}><X size={12}/></button></span>)}</div>}
      {error && <p className="assistant-error" role="alert">{error}</p>}
      {canResume && !running && <button className="secondary-button" type="button" disabled={uploading || externallyBusy || !apiKey} onClick={event => send(event, true)}>继续任务</button>}
      <label className="sr-only" htmlFor="assistant-command">给智能助手的指令</label>
      <textarea id="assistant-command" value={input} maxLength={4000} disabled={running || uploading} placeholder="例如：把当前页的公式整理成笔记，再做一张思维导图" onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }}/>
      <div className="assistant-composer-actions"><button className="secondary-button" type="button" disabled={running || uploading || externallyBusy} onClick={() => attachmentInput.current?.click()}><Paperclip size={16}/>{uploading ? '正在导入…' : '添加图片 / 导入资料'}</button>
        <input ref={attachmentInput} type="file" multiple hidden accept={window.YuanOfflineApp ? '.pdf,image/png,image/jpeg,image/gif,image/webp' : '.pdf,.doc,.docx,.ppt,.pptx,image/png,image/jpeg,image/gif,image/webp'} onChange={uploadFiles}/>
        {running ? <button className="secondary-button" type="button" onClick={stop}><Square size={15}/>停止</button> : <button className="primary-button" disabled={!input.trim() || uploading || externallyBusy || !apiKey} type="submit"><Send size={15}/>发送</button>}
      </div>
    </form>
  </aside>;
}
