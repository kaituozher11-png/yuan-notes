import test from 'node:test';
import assert from 'node:assert/strict';
import { appendGeneratedNote, generatedPageCount } from '../src/aiNoteVersions.js';
const fixture = () => ({ docs: [{ id: 'doc', pages: 2 }], notes: [] });
test('repeated generation allocates per-page versions without changing legacy content or manual notes', () => {
  const state = fixture();
  state.notes.push({ id: 'old', docId: 'doc', page: 1, kind: 'ai', title: '原题', ai: { summary: '旧内容' }, blocks: [{ text: '手写说明' }], links: [{ page: 1 }] });
  state.notes.push({ id: 'own', docId: 'doc', page: 1, kind: 'user', title: '个人' });
  const previous = structuredClone(state.notes);
  for (let i = 2; i <= 12; i++) { const made = appendGeneratedNote(state, { docId: 'doc', page: 1, ai: { summary: `内容${i}` } }); assert.equal(made.generationVersion, i); assert.match(made.title, new RegExp(`版本 ${i}`)); }
  assert.deepEqual(state.notes.slice(0, 2), previous); assert.equal(new Set(state.notes.map(n => n.id)).size, state.notes.length);
  const secondPage = appendGeneratedNote(state, { docId: 'doc', page: 2, ai: {} }); assert.equal(secondPage.generationVersion, 1); assert.equal(generatedPageCount(state.notes, 'doc'), 2);
  state.notes.at(-1).deleted = true; assert.equal(generatedPageCount(state.notes, 'doc'), 1);
  assert.equal(appendGeneratedNote(state, { docId: 'doc', page: 2, ai: {} }).generationVersion, 2);
});
test('deleted versions, custom titles and restored high versions do not reuse numbering', () => {
  const state = fixture();
  const first = appendGeneratedNote(state, { docId: 'doc', page: 1, ai: {} }); first.deleted = true; first.title = '改名';
  assert.equal(appendGeneratedNote(state, { docId: 'doc', page: 1, ai: {} }).generationVersion, 2);
  state.notes.push({ id: 'restored', docId: 'doc', page: 1, kind: 'ai', generationVersion: 20, deleted: true });
  assert.equal(appendGeneratedNote(state, { docId: 'doc', page: 1, ai: {} }).generationVersion, 21);
  const before = structuredClone(state.notes);
  for (const page of [0, 3, 1.2, NaN]) assert.throws(() => appendGeneratedNote(state, { docId: 'doc', page, ai: {} }));
  assert.throws(() => appendGeneratedNote(state, { docId: 'missing', page: 1, ai: {} })); state.docs[0].deleted = true; assert.throws(() => appendGeneratedNote(state, { docId: 'doc', page: 1, ai: {} })); assert.deepEqual(state.notes, before);
});
