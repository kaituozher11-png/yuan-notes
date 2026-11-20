import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { getDataDir } from './store.js';
import { decodeUploadFilename } from './filenames.js';

const run = promisify(execFile);
const office = process.env.LIBREOFFICE_PATH || (process.platform === 'win32' ? 'soffice.com' : 'soffice');
const wordScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wordToPdf.ps1')
  .replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked');
const bin = (name) => {
  if (process.env[`YINGXING_${name.toUpperCase()}_PATH`]) return process.env[`YINGXING_${name.toUpperCase()}_PATH`];
  return name;
};
async function runRequired(command, args, options, tool) {
  try { return await run(command, args, options); }
  catch (error) {
    if (error.code === 'ENOENT') {
      const missing = new Error(`缺少 ${tool}。请先安装并将其添加到系统 PATH。`);
      missing.code = 'MISSING_TOOL';
      throw missing;
    }
    throw error;
  }
}
const types = new Map([['.pdf', 'PDF'], ['.pptx', 'PPTX'], ['.ppt', 'PPT'], ['.docx', 'DOCX'], ['.doc', 'DOC']]);

export function supported(name) { return types.get(path.extname(name).toLowerCase()); }

async function convertToPdf(source, pdf, dir, id, type) {
  const wordFile = type === 'DOCX' || type === 'DOC';
  if (wordFile && process.platform === 'win32') {
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
        '-File', wordScript, '-Source', source, '-Target', pdf], { timeout: 120000, windowsHide: true });
      if ((await fs.stat(pdf)).size === 0) throw new Error('Word created an empty PDF');
      return;
    } catch {
      await fs.rm(pdf, { force: true });
    }
  }
  const profile = path.join(os.tmpdir(), `yingxing-office-${id}`);
  await runRequired(office, [`-env:UserInstallation=file:///${profile.replaceAll('\\', '/')}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, source], { timeout: 120000, windowsHide: true }, 'LibreOffice');
  await fs.rename(path.join(dir, 'source.pdf'), pdf);
  if (wordFile) {
    const { stdout } = await runRequired(bin('pdftotext'), [pdf, '-'], { timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, 'Poppler PDF 工具');
    if (/\bMERGEFORMAT\b|公式节/.test(stdout)) {
      throw new Error('MathType 公式编号无法正确预览。请用 Microsoft Word 将原文另存为 PDF 后导入。');
    }
  }
}

export async function importDocument(file) {
  const filename = decodeUploadFilename(file.originalname);
  const type = supported(filename);
  if (!type) throw new Error('仅支持 PDF、PPT/PPTX、Word/DOCX 文件');
  const id = crypto.randomUUID();
  const dir = path.join(getDataDir(), 'documents', id);
  await fs.mkdir(dir, { recursive: true });
  const source = path.join(dir, `source${path.extname(filename).toLowerCase()}`);
  await fs.writeFile(source, file.buffer);
  const pdf = path.join(dir, 'preview.pdf');
  try {
    if (type === 'PDF') await fs.copyFile(source, pdf);
    else await convertToPdf(source, pdf, dir, id, type);
    const { stdout } = await runRequired(bin('pdfinfo'), [pdf], { timeout: 30000, windowsHide: true }, 'Poppler PDF 工具');
    const pages = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!pages) throw new Error('无法读取文档页数');
    return { id, name: filename.replace(/\.[^.]+$/, ''), filename, type, pages, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), course: '', tags: [], deleted: false };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
}

export function pdfPath(id) { return path.join(getDataDir(), 'documents', id, 'preview.pdf'); }
export async function pageText(id, page, max = 20000) {
  const { stdout } = await runRequired(bin('pdftotext'), ['-f', String(page), '-l', String(page), '-layout', '-enc', 'UTF-8', pdfPath(id), '-'], { timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, 'Poppler PDF 工具');
  return stdout.replace(/\f/g, '').trim().slice(0, max);
}

export async function pageImage(id, page) {
  const prefix = path.join(os.tmpdir(), `yingxing-page-${crypto.randomUUID()}`);
  const args = ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '1200'];
  const options = { timeout: 45000, windowsHide: true };
  try {
    try {
      await runRequired(bin('pdftoppm'), [...args, '-jpeg', '-jpegopt', 'quality=75', pdfPath(id), prefix], options, 'Poppler PDF 工具');
      return `data:image/jpeg;base64,${(await fs.readFile(`${prefix}.jpg`)).toString('base64')}`;
    } catch (error) {
      if (error.code === 'MISSING_TOOL') throw error;
      try {
        await runRequired(bin('pdftoppm'), [...args, '-png', pdfPath(id), prefix], options, 'Poppler PDF 工具');
        return `data:image/png;base64,${(await fs.readFile(`${prefix}.png`)).toString('base64')}`;
      } catch (fallbackError) {
        if (fallbackError.code === 'MISSING_TOOL') throw fallbackError;
        throw new Error('无法转换原文页面图片，请关闭此模型的“处理页面图片”后重试，或检查 PDF 工具是否支持 PNG');
      }
    }
  } finally {
    await Promise.all(['.jpg', '.png'].map((extension) => fs.rm(`${prefix}${extension}`, { force: true })));
  }
}
