import { assistantTools } from './assistantProtocol.js';
import { aiNotePresets, validateAiGuidance, validateAiOutline } from './aiNoteOutline.js';
import { freeNoteBlocks, partsToRich } from './richDocument.js';
import { folderName, folderTarget } from './libraryFolders.js';
import { SHAPES, placeNode } from './mindMapModel.js';
import { validateMarkup } from '../server/markup.js';

const uid = () => crypto.randomUUID();
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const check = (condition, message = '操作参数无效') => { if (!condition) throw new Error(message); };
const str = (value, max, label = '文字', allowEmpty = false) => {
  check(typeof value === 'string' && value.length <= max && (allowEmpty || value.trim()), `${label}须为${allowEmpty ? '0' : '1'}到${max}个字符`);
  return value;
};
const fields = (value, allowed) => { check(object(value)); check(Object.keys(value).every(key => allowed.includes(key)), '包含不支持的修改字段'); return value; };
const color = value => { check(/^#[a-f\d]{6}$/i.test(value), '颜色须为十六进制色值'); return value; };
const number = (value, min, max) => { check(Number.isFinite(value) && value >= min && value <= max, '坐标或尺寸超出范围'); return value; };
const pageOf = (doc, page) => { check(Number.isInteger(page) && page >= 1 && page <= doc.pages, `页码须为1到${doc.pages}的整数`); return page; };
const styleOf = style => {
  fields(style, ['accent', 'paper']);
  if (style.accent !== undefined) color(style.accent);
  if (style.paper !== undefined) check(['plain', 'grid', 'lined'].includes(style.paper), '纸张样式无效');
  return style;
};

function imageSource(value, env) {
  str(value, 7_000_000, '图片地址');
  const source = env.images?.get(value) || value;
  check(/^\/api\/images\/[a-z\d.-]+$/i.test(source) || /^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(source), '请先上传图片，或使用现有笔记的图片引用');
  return source;
}

function drawingOf(value) {
  check(Array.isArray(value) && value.length <= 1000, '手写笔迹数量过多');
  return value.map(stroke => {
    check(['pen', 'highlighter', 'eraser'].includes(stroke.tool)); color(stroke.color); number(stroke.size, 1, 40);
    check(Array.isArray(stroke.points) && stroke.points.length > 0 && stroke.points.length <= 2500);
    stroke.points.forEach(point => { check(Array.isArray(point) && point.length === 2); number(point[0], 0, 900); number(point[1], 0, 3300); });
    return { tool: stroke.tool, color: stroke.color, size: stroke.size, points: stroke.points };
  });
}

function mapOf(part) {
  check(Array.isArray(part.nodes) && part.nodes.length <= 100, '思维导图最多100个节点');
  const ids = new Set();
  const nodes = part.nodes.map(node => {
    str(node.id, 80, '节点编号'); check(!ids.has(node.id), '节点编号重复'); ids.add(node.id);
    str(node.text, 300, '节点文字', true); check(SHAPES.includes(node.shape)); number(node.x, 0, 1200); number(node.y, 0, 700);
    return { id: node.id, text: node.text, shape: node.shape, ...placeNode(node.x, node.y, node) };
  });
  check(part.edges === undefined || Array.isArray(part.edges));
  check((part.edges || []).length <= 300, '连线过多');
  const edgeIds = new Set();
  const edges = (part.edges || []).map(edge => {
    check(ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to, '连线节点不存在或连向自身');
    const id = edge.id || uid(); check(!edgeIds.has(id), '连线编号重复'); edgeIds.add(id);
    check(['curve', 'straight', 'elbow'].includes(edge.style || 'curve'));
    return { id, from: edge.from, to: edge.to, text: str(edge.text || '', 300, '连线文字', true), style: edge.style || 'curve', color: color(edge.color || '#618e90'), width: number(edge.width || 2, 1, 8) };
  });
  return { nodes, edges };
}

function partOf(part, env) {
  check(object(part));
  const id = part.id || uid();
  if (part.type === 'text' || part.type === 'formula') return { id, type: part.type, text: str(part.text, 20000, '内容', true) };
  if (part.type === 'image') return { id, type: 'image', data: imageSource(part.data, env), text: str(part.text || '', 500, '图片说明', true), width: number(part.width ?? 100, 20, 100), align: ['left', 'center', 'right'].includes(part.align) ? part.align : 'left' };
  if (part.type === 'drawing') return { id, type: 'drawing', strokes: drawingOf(part.strokes || []), height: number(part.height || 420, 420, 3300) };
  if (part.type === 'mindmap') return { id, type: 'mindmap', ...mapOf(part) };
  throw new Error('不支持的笔记内容类型');
}

function richOf(doc, env) {
  check(doc?.type === 'doc' && Array.isArray(doc.content), '富文本格式无效');
  let count = 0;
  function nodeOf(node, depth = 0) {
    check(object(node) && ++count <= 3000 && depth <= 16, '笔记内容过多');
    const type = node.type;
    if (type === 'text') {
      const result = { type, text: str(node.text, 20000, '正文') };
      if (node.marks) result.marks = node.marks.map(mark => { check(['bold', 'italic', 'strike', 'code', 'underline'].includes(mark.type), '不支持的文字样式'); return { type: mark.type }; });
      return result;
    }
    if (type === 'formulaInline') return { type, attrs: { id: node.attrs?.id || uid(), latex: str(node.attrs?.latex || '', 12000, '公式', true) } };
    if (type === 'noteImage') { const part = partOf({ type: 'image', data: node.attrs?.src, text: node.attrs?.alt, width: node.attrs?.width, align: node.attrs?.align }, env); return { type, attrs: { src: part.data, alt: part.text, width: part.width, align: part.align } }; }
    if (type === 'noteDrawing') return { type, attrs: { strokes: drawingOf(node.attrs?.strokes || []), height: number(node.attrs?.height || 420, 420, 3300) } };
    check(['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'hardBreak', 'horizontalRule', 'codeBlock'].includes(type), '不支持的富文本节点');
    return { type, ...(type === 'heading' ? { attrs: { level: number(node.attrs?.level || 2, 1, 6) } } : {}), ...(node.content ? { content: node.content.map(child => nodeOf(child, depth + 1)) } : {}) };
  }
  return nodeOf(doc);
}

function blockOf(block, env, id) {
  if (block.type === 'mixed') return { id, type: 'mixed', rich: richOf(block.rich || partsToRich((block.parts || []).map(part => partOf(part, env))), env) };
  return { ...partOf(block, env), id };
}

function appendParts(blocks, parts, env) {
  check(Array.isArray(parts) && parts.length > 0 && parts.length <= 100, '请提供1到100项内容');
  return freeNoteBlocks([...blocks, ...parts.map(part => partOf(part, env))]);
}

const docInfo = doc => ({ id: doc.id, name: doc.name, course: doc.course, pages: doc.pages, folderId: doc.folderId || null, deleted: !!doc.deleted });
const noteInfo = note => ({ id: note.id, docId: note.docId, page: note.page, title: note.title, kind: note.kind, deleted: !!note.deleted });

export function assistantContext(state, current, attachments = []) {
  const doc = state.docs.find(item => item.id === current.docId && !item.deleted);
  return { current: doc ? { document: docInfo(doc), page: current.page, noteId: current.noteId || null, selection: String(current.selection || '').slice(0, 3000), rect: current.rect || null } : null,
    documents: state.docs.filter(item => !item.deleted).slice(0, 30).map(docInfo), folders: (state.folders || []).slice(0, 80),
    templates: state.templates.slice(0, 30), attachments, documentCount: state.docs.filter(item => !item.deleted).length };
}

// The executor only accepts named capabilities, then rechecks real objects before any write.
export async function prepareAssistantTool(tool, env) {
  check(Object.hasOwn(assistantTools, tool?.name), '不支持的助手操作');
  const args = tool.args; check(object(args));
  const state = await env.api('/state');
  const docBy = (id, deleted = false) => { const doc = state.docs.find(item => item.id === id && (deleted || !item.deleted)); check(doc, '资料不存在，或已移入回收站'); return doc; };
  const noteBy = (id, deleted = false) => { const note = state.notes.find(item => item.id === id && (deleted || !item.deleted)); check(note, '笔记不存在，或已移入回收站'); docBy(note.docId); return note; };
  const folderBy = id => { const folder = (state.folders || []).find(item => item.id === id); check(folder, '文件夹不存在'); return folder; };
  const request = (path, method, body) => { env.signal?.throwIfAborted(); return env.api(path, { method, body: JSON.stringify(body) }); };
  const task = (label, run, confirm = false) => ({ label, run, confirm });
  const saveNote = (note, changes) => async () => {
    env.signal?.throwIfAborted();
    const latest = (await env.api('/state')).notes.find(item => item.id === note.id);
    check(JSON.stringify(latest) === JSON.stringify(note), '笔记已发生变化，请重新读取后再修改');
    const saved = await request(`/notes/${note.id}`, 'PUT', changes);
    env.recordNoteHistory?.(note, saved);
    return noteInfo(saved);
  };
  const latestDocPage = async (doc, page) => {
    const fresh = (await env.api('/state')).docs.find(item => item.id === doc.id && !item.deleted);
    check(fresh, '资料已移入回收站'); pageOf(fresh, page);
  };
  switch (tool.name) {
    case 'search': {
      const query = str(args.query ?? '', 300, '关键词', true).toLocaleLowerCase();
      check(args.deleted === undefined || typeof args.deleted === 'boolean');
      const deleted = !!args.deleted;
      const docs = state.docs.filter(item => !!item.deleted === deleted && `${item.name} ${item.filename} ${item.course}`.toLocaleLowerCase().includes(query));
      const notes = state.notes.filter(item => !!item.deleted === deleted && state.docs.some(doc => doc.id === item.docId && !doc.deleted) && JSON.stringify([item.title, item.ai, item.blocks]).toLocaleLowerCase().includes(query));
      return task(`查找${query || '资料库'}`, async () => ({ documents: docs.slice(0, 60).map(docInfo), notes: notes.slice(0, 60).map(noteInfo), folders: (state.folders || []).filter(item => item.name.toLocaleLowerCase().includes(query)), templates: state.templates, documentMatches: docs.length, noteMatches: notes.length, truncated: docs.length > 60 || notes.length > 60 }));
    }
    case 'read_page': {
      const doc = docBy(args.docId); const page = pageOf(doc, args.page);
      return task(`读取《${doc.name}》第${page}页`, async () => ({ document: docInfo(doc), page, ...await env.api(`/docs/${doc.id}/pages/${page}/text`, { signal: env.signal }) }));
    }
    case 'read_note': {
      const note = noteBy(args.noteId, true);
      return task(`读取笔记“${note.title}”`, async () => env.publicData ? env.publicData(note) : note);
    }
    case 'open_document': {
      const doc = docBy(args.docId); const page = pageOf(doc, args.page);
      check(['doc', 'split', 'note'].includes(args.layout || 'split'));
      if (args.noteId) { const note = noteBy(args.noteId); check(note.docId === doc.id && note.page === page, '笔记与原文页不对应'); }
      if (args.zoom !== undefined) number(args.zoom, 0.5, 3);
      return task(`打开《${doc.name}》第${page}页`, async () => { env.navigate({ ...args, doc, page }); return { opened: true, ...docInfo(doc), page }; });
    }
    case 'create_folder': {
      const name = folderName(args.name);
      check(!state.folders.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase()), '文件夹名称已存在');
      return task(`新建文件夹“${name}”`, () => request('/folders', 'POST', { name }));
    }
    case 'update_folder': {
      const folder = folderBy(args.folderId); const name = folderName(args.name);
      return task(`将文件夹“${folder.name}”改为“${name}”`, () => request(`/folders/${folder.id}`, 'PATCH', { name }));
    }
    case 'delete_folder': {
      const folder = folderBy(args.folderId);
      check(!state.docs.some(item => !item.deleted && item.folderId === folder.id), '文件夹中仍有资料，请先移出');
      return task(`删除空文件夹“${folder.name}”`, () => request(`/folders/${folder.id}`, 'DELETE'), true);
    }
    case 'update_document': {
      const doc = docBy(args.docId, true); const changes = fields(args.changes, ['name', 'course', 'folderId', 'deleted']); check(Object.keys(changes).length > 0);
      if (changes.name !== undefined) str(changes.name, 150, '资料名称');
      if (changes.course !== undefined) str(changes.course, 100, '课程', true);
      if ('folderId' in changes) folderTarget(state, changes.folderId);
      if ('deleted' in changes) check(typeof changes.deleted === 'boolean');
      const details = [changes.name !== undefined ? `改名为“${changes.name}”` : '', changes.course !== undefined ? `课程设为“${changes.course}”` : '', 'folderId' in changes ? changes.folderId ? `移入“${folderBy(changes.folderId).name}”文件夹` : '移到根目录' : ''].filter(Boolean).join('；');
      const label = changes.deleted === true ? `将《${doc.name}》移入回收站` : changes.deleted === false ? `恢复《${doc.name}》` : `《${doc.name}》：${details}`;
      return task(label, async () => docInfo(await request(`/docs/${doc.id}`, 'PATCH', changes)), changes.deleted === true);
    }
    case 'create_note': {
      const doc = docBy(args.docId); const page = pageOf(doc, args.page); const title = str(args.title, 100, '笔记标题');
      const blocks = args.parts ? appendParts([], args.parts, env) : [];
      return task(`在《${doc.name}》第${page}页新建笔记“${title}”`, async () => {
        const made = await request('/notes', 'POST', { docId: doc.id, page, title, blocks });
        return noteInfo(made);
      });
    }
    case 'append_content': {
      const note = noteBy(args.noteId); const blocks = appendParts(note.blocks || [], args.parts, env);
      return task(`向“${note.title}”追加${args.parts.length}项内容`, saveNote(note, { blocks }));
    }
    case 'update_note': {
      const note = noteBy(args.noteId, true); const changes = fields(args.changes, ['title', 'ai', 'style', 'deleted']); check(Object.keys(changes).length > 0);
      if (changes.title !== undefined) str(changes.title, 100, '笔记标题');
      if (changes.ai !== undefined) {
        check(note.kind === 'ai' && Array.isArray(changes.ai?.sections), '请选择智能笔记');
        validateAiOutline(changes.ai.sections.map(item => item.title));
        changes.ai.sections.forEach(item => str(item.content, 20000, '笔记正文', true));
      }
      if (changes.style) styleOf(changes.style);
      if ('deleted' in changes) check(typeof changes.deleted === 'boolean');
      return task(`${changes.deleted === true ? '移入回收站' : changes.deleted === false ? '恢复' : '修改'}笔记“${note.title}”`, saveNote(note, changes), changes.deleted === true || 'ai' in changes);
    }
    case 'update_block': {
      const note = noteBy(args.noteId); check(note.blocks?.some(item => item.id === args.blockId), '区块不存在，请先读取笔记');
      const block = args.block === null ? null : blockOf(args.block, env, args.blockId);
      const blocks = block ? note.blocks.map(item => item.id === args.blockId ? block : item) : note.blocks.filter(item => item.id !== args.blockId);
      return task(`${block ? '修改' : '删除'}“${note.title}”中的区块`, saveNote(note, { blocks }), true);
    }
    case 'duplicate_note': {
      const note = noteBy(args.noteId); const title = str(args.title || `${note.title} 副本`, 100, '笔记标题');
      return task(`复制笔记“${note.title}”`, async () => noteInfo(await request('/notes', 'POST', { docId: note.docId, page: note.page, title, blocks: note.blocks, links: note.links, ai: note.ai, kind: note.kind, style: note.style })));
    }
    case 'reorder_blocks': {
      const note = noteBy(args.noteId); const ids = (note.blocks || []).map(block => block.id);
      check(Array.isArray(args.ids) && args.ids.length === ids.length && new Set(args.ids).size === ids.length && args.ids.every(id => ids.includes(id)), '请提供笔记全部区块编号');
      return task(`调整“${note.title}”的内容顺序`, saveNote(note, { blocks: args.ids.map(id => note.blocks.find(block => block.id === id)) }), true);
    }
    case 'reorder_notes': {
      const doc = docBy(args.docId); const page = pageOf(doc, args.page);
      const ids = state.notes.filter(item => item.docId === doc.id && item.page === page && !item.deleted).map(item => item.id);
      check(Array.isArray(args.ids) && args.ids.length === ids.length && new Set(args.ids).size === ids.length && args.ids.every(id => ids.includes(id)), '请提供该页全部笔记的编号');
      return task(`调整《${doc.name}》第${page}页笔记顺序`, async () => (await request('/notes/reorder', 'POST', { ids: args.ids })).map(noteInfo));
    }
    case 'link_source': {
      const note = noteBy(args.noteId); const doc = docBy(note.docId); const links = structuredClone(note.links || []);
      const index = args.linkId ? links.findIndex(item => item.id === args.linkId) : -1;
      if (args.linkId) check(index >= 0, '原文关联不存在');
      if (args.remove) { check(index >= 0); links.splice(index, 1); }
      else {
        const page = pageOf(doc, args.page);
        if (args.rect) { const rect = fields(args.rect, ['x', 'y', 'width', 'height']); number(rect.x, 0, 1); number(rect.y, 0, 1); number(rect.width, 0.015, 1 - rect.x); number(rect.height, 0.015, 1 - rect.y); }
        check(args.annotations === undefined || Array.isArray(args.annotations)); check((args.annotations || []).length <= 30);
        const annotations = (args.annotations || []).map(item => { const part = partOf(item, env); check(['text', 'formula', 'image'].includes(part.type)); return part; });
        const previous = index >= 0 ? links[index] : {};
        const quote = args.quote === undefined ? previous.quote || '' : str(args.quote, 3000, '原文选区', true);
        const rect = args.rect || (args.quote === undefined ? previous.rect || null : null);
        const link = { ...previous, id: args.linkId || uid(), docId: doc.id, page, quote, rect, rects: args.rect ? [args.rect] : args.quote !== undefined ? [] : previous.rects || [], ...(args.annotations ? { annotations } : {}), type: rect ? 'region' : quote ? 'text' : 'page' };
        if (index >= 0) links[index] = link; else links.push(link);
      }
      return task(`${args.remove ? '删除' : '更新'}“${note.title}”的原文关联及批注`, saveNote(note, { links }), !!args.linkId);
    }
    case 'read_markup': {
      const doc = docBy(args.docId); const page = pageOf(doc, args.page);
      return task(`读取《${doc.name}》第${page}页标记`, async () => ({ docId: doc.id, page, ...(doc.markup?.[page] || { strokes: [], stickies: [] }) }));
    }
    case 'update_markup': {
      const doc = docBy(args.docId); const page = pageOf(doc, args.page); const previous = doc.markup?.[page] || { strokes: [], stickies: [] };
      const markup = validateMarkup({ strokes: args.strokes ?? previous.strokes, stickies: args.stickies ?? previous.stickies });
      return task(`修改《${doc.name}》第${page}页的笔迹/便利贴`, async () => {
        const latest = (await env.api('/state')).docs.find(item => item.id === doc.id && !item.deleted);
        check(latest && JSON.stringify(latest.markup?.[page] || { strokes: [], stickies: [] }) === JSON.stringify(previous), '原文标记已变化，请重新读取');
        return request(`/docs/${doc.id}/pages/${page}/markup`, 'PUT', markup);
      }, true);
    }
    case 'generate_notes': {
      const doc = docBy(args.docId);
      check(Array.isArray(args.pages) && args.pages.length > 0 && args.pages.length <= 10 && new Set(args.pages).size === args.pages.length, '每次生成1到10页，页码不能重复');
      args.pages.forEach(page => pageOf(doc, page));
      const preset = args.preset || 'course'; check(Object.hasOwn(aiNotePresets, preset), '模板须为论文或课件');
      const outline = validateAiOutline(args.outline || aiNotePresets[preset].titles); const guidance = validateAiGuidance(args.guidance || '');
      return task(`生成《${doc.name}》第${args.pages.join('、')}页的智能笔记`, async () => {
        const results = [];
        for (const page of args.pages) {
          env.signal?.throwIfAborted(); await latestDocPage(doc, page);
          const fresh = await env.api('/state');
          if (fresh.notes.some(item => item.docId === doc.id && item.page === page && item.kind === 'ai' && !item.deleted)) { results.push({ page, skipped: '已有智能笔记，未覆盖' }); continue; }
          try {
            const note = await env.api('/generate', { method: 'POST', body: JSON.stringify({ ...env.model, docId: doc.id, page, outline, guidance }), signal: env.signal });
            results.push({ page, note: noteInfo(note) });
          } catch (error) { if (env.signal?.aborted) throw error; results.push({ page, error: error.message }); }
          env.progress?.(`已处理第${page}页`);
        }
        return results;
      });
    }
    case 'preview_generation': {
      const doc = docBy(args.docId); const page = pageOf(doc, args.page);
      const preset = args.preset || 'course'; check(Object.hasOwn(aiNotePresets, preset), '模板须为论文或课件');
      const outline = validateAiOutline(args.outline || aiNotePresets[preset].titles); const guidance = validateAiGuidance(args.guidance || '');
      check(env.previews, '草稿会话尚未就绪');
      const previous = state.notes.find(note => note.docId === doc.id && note.page === page && note.kind === 'ai' && !note.deleted)?.ai || null;
      return task(`准备《${doc.name}》第${page}页的智能笔记对比草稿`, async () => {
        const candidate = await env.api('/generate', { method: 'POST', body: JSON.stringify({ ...env.model, docId: doc.id, page, outline, guidance, preview: true }), signal: env.signal });
        env.previews.set(candidate.token, { ...candidate, docId: doc.id, page, previous });
        return candidate;
      });
    }
    case 'commit_generation': {
      const candidate = env.previews?.get(args.token); check(candidate, '本次对话没有该草稿，请先生成对比草稿');
      const doc = docBy(candidate.docId);
      const unchanged = async () => {
        const latest = (await env.api('/state')).notes.find(note => note.docId === doc.id && note.page === candidate.page && note.kind === 'ai' && !note.deleted)?.ai || null;
        check(JSON.stringify(latest) === JSON.stringify(candidate.previous), '原智能笔记已经变化，请重新生成对比草稿');
      };
      await unchanged();
      return { ...task(`替换《${doc.name}》第${candidate.page}页智能笔记正文，保留个人补充`, async () => {
        await unchanged(); const note = await request('/generate/commit', 'POST', { token: args.token }); env.previews.delete(args.token); return noteInfo(note);
      }, true), confirmData: { 原有内容: candidate.previous, 新草稿: candidate.ai } };
    }
    case 'create_template': case 'update_template': {
      const name = str(args.name, 80, '模板名称'); check(Array.isArray(args.sections) && args.sections.length <= 30); args.sections.forEach(item => str(item, 80, '模板标题')); if (args.style) styleOf(args.style);
      const update = tool.name === 'update_template';
      if (update) check(state.templates.some(item => item.id === args.templateId), '模板不存在');
      return task(`${update ? '修改' : '新建'}模板“${name}”`, () => request(update ? `/templates/${args.templateId}` : '/templates', update ? 'PUT' : 'POST', { name, sections: args.sections, ...(args.style ? { style: args.style } : {}) }));
    }
    case 'delete_template': {
      const template = state.templates.find(item => item.id === args.templateId); check(template, '模板不存在');
      return task(`删除模板“${template.name}”`, () => request(`/templates/${template.id}`, 'DELETE'), true);
    }
    case 'export_notes': { const doc = docBy(args.docId); return task(`准备导出《${doc.name}》的笔记`, async () => { env.download('notes', doc); return { ready: true, message: '请点击对话中的下载按钮' }; }); }
    case 'backup': return task('准备资料库备份', async () => { env.download('backup'); return { ready: true, message: '请点击对话中的下载按钮' }; });
    case 'copy_text': {
      const text = str(args.text || env.current?.selection || '', 20000, '复制的文字');
      return task('准备复制文字', async () => { env.copy(text); return { ready: true, message: '请点击对话中的复制按钮' }; });
    }
    case 'configure_view': {
      check(env.current?.docId, '请先打开一份资料');
      const value = fields(args, ['layout', 'zoom', 'noteWidth', 'treeOpen', 'showStickies', 'stickyPlacement']);
      if (value.layout !== undefined) check(['doc', 'split', 'note'].includes(value.layout));
      if (value.zoom !== undefined) number(value.zoom, .5, 3);
      if (value.noteWidth !== undefined) number(value.noteWidth, 220, 1200);
      for (const key of ['treeOpen', 'showStickies']) if (value[key] !== undefined) check(typeof value[key] === 'boolean');
      if (value.stickyPlacement !== undefined) check(['single', 'multiple'].includes(value.stickyPlacement));
      return task('调整阅读界面', async () => { env.view(value); return { updated: true, ...value }; });
    }
    case 'open_feature': {
      check(['import', 'restore', 'models', 'templates', 'trash', 'library', 'drawing', 'mindmap', 'formula', 'image', 'region', 'pen', 'highlighter', 'eraser', 'sticky', 'undo', 'redo'].includes(args.feature), '功能入口不存在');
      let doc;
      if (!['import', 'restore', 'models', 'templates', 'trash', 'library'].includes(args.feature)) { doc = docBy(args.docId); pageOf(doc, args.page); if (args.noteId) { const note = noteBy(args.noteId); check(note.docId === doc.id && note.page === args.page); } }
      const titles = { import: '资料导入', restore: '备份恢复', models: '模型连接', templates: '模板管理', trash: '回收站', library: '资料库', drawing: '手写笔记', mindmap: '思维导图', formula: '公式编辑', image: '图片编辑', region: '原文框选', pen: '画笔', highlighter: '荧光笔', eraser: '橡皮擦', sticky: '便利贴', undo: '撤销', redo: '重做' };
      return task(`打开${titles[args.feature]}功能`, async () => await env.feature({ ...args, doc }) || { opened: true, requiresUserInteraction: true, message: '已打开操作入口，需用户在界面完成交互，不代表操作已完成。' });
    }
    default: throw new Error('未实现的助手操作');
  }
}
