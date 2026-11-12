/** Importable library material. Source code and markup are read as data, never executed. */
import { basename, extname } from 'node:path';

const image = new Set('jpg jpeg png webp gif avif bmp tif tiff heic heif'.split(' '));
const video = new Set('mp4 mov webm mkv avi m4v mpg mpeg'.split(' '));
const audio = new Set('mp3 wav flac ogg m4a aac opus aiff aif'.split(' '));
const text = new Set('md markdown mdx txt text json jsonc js mjs cjs ts tsx jsx html htm css scss sass less py csv tsv yaml yml toml xml svg'.split(' '));

/** SVG remains source text: analysis must not claim its rendered appearance was inspected. */
export function classifyImportFile(path) {
  if (typeof path !== 'string' || !path || basename(path).startsWith('.')) return null;
  const extension = extname(path).slice(1).toLowerCase();
  if (image.has(extension)) return 'image';
  if (video.has(extension)) return 'video';
  if (audio.has(extension)) return 'audio';
  if (text.has(extension)) return 'text';
  return null;
}

export function isImportFile(path) { return classifyImportFile(path) !== null; }
