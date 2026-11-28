const paragraph = (content = []) => ({ type: 'paragraph', ...(content.length ? { content } : {}) });
const text = (value) => value ? { type: 'text', text: value } : null;

export function normalizeRichDocument(doc) {
  if (doc?.type !== 'doc') return doc;
  const content = [];
  for (let index = 0; index < (doc.content || []).length; index += 1) {
    const node = doc.content[index];
    if (node.type !== 'noteImage') {
      content.push(node);
      continue;
    }
    const next = doc.content[index + 1];
    content.push(paragraph([node, ...(next?.type === 'paragraph' ? next.content || [] : [])]));
    if (next?.type === 'paragraph') index += 1;
  }
  return { ...doc, content: content.length ? content : [paragraph()] };
}

export function partsToRich(parts = []) {
  const content = [];
  let inline = [];
  function flush() {
    if (inline.length) content.push(paragraph(inline));
    inline = [];
  }
  for (const part of parts) {
    if (part.type === 'text') {
      const lines = String(part.text || '').split('\n');
      lines.forEach((line, index) => {
        if (index) inline.push({ type: 'hardBreak' });
        if (line) inline.push(text(line));
      });
    } else if (part.type === 'formula') {
      inline.push({ type: 'formulaInline', attrs: { id: part.id, latex: part.text || '' } });
    } else if (part.type === 'image') {
      inline.push({ type: 'noteImage', attrs: {
        src: part.data || '', alt: part.text || '', width: part.width || 100, align: part.align || 'left',
      } });
    } else {
      flush();
      if (part.type === 'drawing') content.push({ type: 'noteDrawing', attrs: { strokes: part.strokes || [], height: part.height || null } });
      if (part.type === 'mindmap') content.push({ type: 'noteMindMap', attrs: { nodes: part.nodes || [], edges: part.edges, width: part.width, height: part.height } });
    }
  }
  flush();
  if (!content.length || content.at(-1).type !== 'paragraph') content.push(paragraph());
  return { type: 'doc', content };
}

export function blockToRich(block) {
  if (block.rich?.type === 'doc') return normalizeRichDocument(block.rich);
  if (block.type === 'mixed') return partsToRich(block.parts);
  return partsToRich([block]);
}

export function blocksToRich(blocks = []) {
  const content = blocks.flatMap((block, index) => {
    const nodes = blockToRich(block).content || [];
    if (index === blocks.length - 1) return nodes;
    return nodes.at(-1)?.type === 'paragraph' && !nodes.at(-1).content ? nodes.slice(0, -1) : nodes;
  });
  return { type: 'doc', content: content.length ? content : [paragraph()] };
}

export function freeNoteBlocks(blocks = []) {
  const result = [];
  let pending = [];
  let pendingId = null;
  const usedIds = new Set();
  function flush() {
    if (pending.length) result.push({ id: pendingId, type: 'mixed', rich: { type: 'doc', content: pending } });
    pending = [];
    pendingId = null;
  }
  for (const block of blocks) {
    if (block.type === 'mindmap') {
      flush();
      result.push(block);
      continue;
    }
    const content = blockToRich(block).content || [];
    for (let index = 0; index < content.length; index += 1) {
      const item = content[index];
      if (item.type === 'noteMindMap') {
        flush();
        result.push({ id: item.attrs?.id || `${block.id}-map-${index}`, type: 'mindmap', nodes: item.attrs?.nodes || [], edges: item.attrs?.edges, ...(item.attrs?.width ? { width: item.attrs.width } : {}), ...(item.attrs?.height ? { height: item.attrs.height } : {}) });
      } else {
        if (!pendingId) {
          pendingId = usedIds.has(block.id) ? `${block.id}-text-${index}` : block.id;
          usedIds.add(pendingId);
        }
        if (pending.length || item.content?.length || item.type !== 'paragraph' || block.rich?.type === 'doc') pending.push(item);
      }
    }
  }
  flush();
  return result.length ? result : [{ id: blocks[0]?.id || 'empty', type: 'mixed', rich: { type: 'doc', content: [paragraph()] } }];
}

export function richText(doc) {
  function collect(node) {
    if (node.type === 'text') return node.text || '';
    if (node.type === 'formulaInline') return node.attrs?.latex || '';
    if (node.type === 'noteImage') return node.attrs?.alt || '';
    if (node.type === 'noteMindMap') return (node.attrs?.nodes || []).map((item) => item.text).join(' ');
    return (node.content || []).map(collect).join(' ');
  }
  return collect(doc || {});
}
