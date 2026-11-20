import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, getState, mutate } from './store.js';
import { repairedDocumentName } from './filenames.js';

const state = await getState();
const repairs = state.docs.map((doc) => ({ doc, repaired: repairedDocumentName(doc) })).filter(({ repaired }) => repaired);
if (!repairs.length) {
  console.log('没有需要修复的文件名');
  process.exit(0);
}

for (const { doc, repaired } of repairs) console.log(`${doc.id}: ${doc.filename} -> ${repaired.filename}`);
if (process.argv.includes('--dry-run')) process.exit(0);

const stateFile = path.join(dataDir, 'state.json');
const backup = path.join(dataDir, `state.before-filename-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await fs.copyFile(stateFile, backup, fs.constants.COPYFILE_EXCL);
await mutate((current) => {
  for (const { doc, repaired } of repairs) {
    const target = current.docs.find((item) => item.id === doc.id);
    target.filename = repaired.filename;
    target.name = repaired.name;
  }
});
console.log(`已修复 ${repairs.length} 份资料；备份：${backup}`);
