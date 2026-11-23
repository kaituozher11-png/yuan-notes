export function folderName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 80) throw new Error('文件夹名称须为 1 到 80 个字符');
  return name;
}

export function folderTarget(state, value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !state.folders?.some((folder) => folder.id === value)) {
    throw new Error('目标文件夹不存在，请刷新资料库后重试');
  }
  return value;
}

export function createFolder(state, name) {
  const clean = folderName(name);
  if (state.folders.some((folder) => folder.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
    throw new Error('文件夹名称已存在');
  }
  const folder = { id: crypto.randomUUID(), name: clean, createdAt: new Date().toISOString() };
  state.folders.push(folder);
  return folder;
}
