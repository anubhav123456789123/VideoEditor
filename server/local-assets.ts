// Local asset library: the product-root folders assets/sfx, assets/music,
// assets/transitions and assets/motion-graphics are scanned on every request
// (cheap: a few dozen files) so files dropped into a folder show up without a
// restart. Files are served at their root-relative URL by product-assets.ts
// (assets/sfx/whoosh.mp3 → /sfx/whoosh.mp3).
//
// Per-kind formats:
//   sfx, music        audio files (.mp3 .wav .ogg .m4a .aac .flac); one level of
//                     sub-folders becomes the category
//   transitions       two-input GLSL ES 3.00 fragment shaders (.glsl / .frag)
//                     using u_outgoing / u_incoming / u_progress
//   motion-graphics   Remotion MG components (.jsx / .tsx, the MG template
//                     contract) or HyperFrames compositions (.html)
// Any file may carry a sidecar <name>.json with display metadata (name,
// description, props, propSchema, durationInFrames / durationSeconds, width,
// height); unknown keys are ignored.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import { PRODUCT_ASSETS_DIR } from './product-assets.ts';

export const LOCAL_ASSET_KINDS = ['sfx', 'music', 'transitions', 'motion-graphics'] as const;
export type LocalAssetKind = (typeof LOCAL_ASSET_KINDS)[number];

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);
const TRANSITION_EXTENSIONS = new Set(['.glsl', '.frag']);
const MG_EXTENSIONS = new Set(['.jsx', '.tsx', '.html']);
const MAX_TEXT_BYTES = 512_000;

export interface LocalAssetEntry {
  /** Stable id: kind + relative path (e.g. "sfx/ui/click.mp3"). */
  id: string;
  kind: LocalAssetKind;
  name: string;
  /** Root-relative URL served by product-assets.ts. */
  url: string;
  /** First-level sub-folder, or "" for files directly in the kind folder. */
  category: string;
  bytes: number;
  modifiedAt: number;
  /** motion-graphics only: which engine renders the file. */
  engine?: 'remotion' | 'hyperframes';
  meta: Record<string, unknown>;
}

export type LocalAssetLibrary = Record<LocalAssetKind, LocalAssetEntry[]>;

function acceptsExtension(kind: LocalAssetKind, ext: string): boolean {
  if (kind === 'sfx' || kind === 'music') return AUDIO_EXTENSIONS.has(ext);
  if (kind === 'transitions') return TRANSITION_EXTENSIONS.has(ext);
  return MG_EXTENSIONS.has(ext);
}

function displayName(file: string): string {
  const words = basename(file, extname(file)).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function readSidecar(file: string): Record<string, unknown> {
  const sidecar = file.slice(0, -extname(file).length) + '.json';
  if (!existsSync(sidecar)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(sidecar, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function urlFor(root: string, file: string): string {
  return '/' + relative(root, file).split(sep).map(encodeURIComponent).join('/');
}

function listFiles(dir: string, depth: number): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory() && depth > 0) out.push(...listFiles(path, depth - 1));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** Scan one kind folder under `root` (defaults to the product assets dir). */
export function scanLocalAssets(kind: LocalAssetKind, root: string = PRODUCT_ASSETS_DIR): LocalAssetEntry[] {
  const dir = join(root, kind);
  const entries: LocalAssetEntry[] = [];
  for (const file of listFiles(dir, 1)) {
    const ext = extname(file).toLowerCase();
    if (!acceptsExtension(kind, ext)) continue;
    const stat = statSync(file);
    const rel = relative(dir, file).split(sep);
    const meta = readSidecar(file);
    entries.push({
      id: `${kind}/${rel.join('/')}`,
      kind,
      name: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : displayName(file),
      url: urlFor(root, file),
      category: rel.length > 1 ? rel[0]! : '',
      bytes: stat.size,
      modifiedAt: stat.mtimeMs,
      ...(kind === 'motion-graphics' ? { engine: ext === '.html' ? 'hyperframes' as const : 'remotion' as const } : {}),
      meta,
    });
  }
  return entries.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function scanLocalAssetLibrary(root: string = PRODUCT_ASSETS_DIR): LocalAssetLibrary {
  return Object.fromEntries(LOCAL_ASSET_KINDS.map((kind) => [kind, scanLocalAssets(kind, root)])) as LocalAssetLibrary;
}

/** Resolve a library id ("motion-graphics/x.html") to a file inside its kind folder, or null. */
export function resolveLocalAsset(id: string, root: string = PRODUCT_ASSETS_DIR): string | null {
  const [kind, ...rest] = id.split('/');
  if (!LOCAL_ASSET_KINDS.includes(kind as LocalAssetKind) || !rest.length || rest.length > 2) return null;
  if (rest.some((part) => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) return null;
  const file = join(root, kind!, ...rest);
  if (!acceptsExtension(kind as LocalAssetKind, extname(file).toLowerCase())) return null;
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** Read a text asset (shader / MG source) with a size cap. */
export function readLocalAssetText(file: string): string {
  if (statSync(file).size > MAX_TEXT_BYTES) throw new Error('asset file is too large');
  return readFileSync(file, 'utf8');
}

export function slugify(value: string): string {
  const slug = value.toLowerCase().normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, 48) || 'motion-graphic';
}

/** Save a generated motion graphic into assets/motion-graphics; returns its library id. */
export async function saveMotionGraphic(
  input: { name: string; engine: 'remotion' | 'hyperframes'; source: string; meta: Record<string, unknown> },
  root: string = PRODUCT_ASSETS_DIR,
): Promise<string> {
  const dir = join(root, 'motion-graphics', 'generated');
  await mkdir(dir, { recursive: true });
  const ext = input.engine === 'hyperframes' ? '.html' : '.jsx';
  let base = slugify(input.name);
  for (let n = 2; existsSync(join(dir, base + ext)); n += 1) base = `${slugify(input.name)}-${n}`;
  await writeFile(join(dir, base + ext), input.source, 'utf8');
  await writeFile(join(dir, base + '.json'), JSON.stringify({ name: input.name, ...input.meta }, null, 2) + '\n', 'utf8');
  return `motion-graphics/generated/${base}${ext}`;
}
