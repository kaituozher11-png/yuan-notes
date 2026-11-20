import path from 'node:path';

// Multipart parsers may expose UTF-8 filename bytes as Latin-1 characters.
export function decodeUploadFilename(filename) {
  if (typeof filename !== 'string' || !/[\u0080-\u00ff]/.test(filename)) return filename;
  if ([...filename].some((character) => character.codePointAt(0) > 0xff)) return filename;

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(filename, 'latin1'));
    return Buffer.from(decoded, 'utf8').toString('latin1') === filename ? decoded : filename;
  } catch {
    return filename;
  }
}

export function repairedDocumentName(doc) {
  const filename = decodeUploadFilename(doc.filename);
  if (filename === doc.filename) return null;
  const oldStem = path.parse(doc.filename).name;
  const name = doc.name === oldStem ? path.parse(filename).name : doc.name;
  return { filename, name };
}
