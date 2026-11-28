// Version numbers are allocated inside each store's serialized mutation.
// Deleted notes count too, so restoring an older copy never collides with a new one.
export function generatedNotes(notes, docId, page) {
  return notes.filter(note => note.docId === docId && note.page === page && note.kind === 'ai');
}
export function appendGeneratedNote(state, { docId, page, ai }) {
  if (!state.docs.some(doc => doc.id === docId && !doc.deleted && Number.isInteger(page) && page >= 1 && page <= doc.pages)) throw new Error('原文页不存在或资料已删除');
  const siblings = generatedNotes(state.notes, docId, page);
  const version = Math.max(siblings.length, ...siblings.map(note => Number.isSafeInteger(note.generationVersion) && note.generationVersion > 0 ? note.generationVersion : 0)) + 1;
  const now = new Date().toISOString();
  const order = Math.max(-1, ...state.notes.filter(note => note.docId === docId && note.page === page).map(note => Number.isFinite(note.order) ? note.order : 0)) + 1;
  const note = { id: crypto.randomUUID(), docId, page, generationVersion: version, order,
    title: `第 ${page} 页 · 智能笔记（版本 ${version}）`, kind: 'ai', ai, blocks: [], links: [], status: 'done', deleted: false, createdAt: now, updatedAt: now };
  state.notes.push(note);
  return note;
}
export function generatedPageCount(notes, docId) {
  return new Set(notes.filter(note => note.docId === docId && note.kind === 'ai' && !note.deleted).map(note => note.page)).size;
}
