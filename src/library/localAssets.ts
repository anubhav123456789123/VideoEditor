// Client side of the local asset library (server/local-assets.ts): lists the
// assets/{sfx,music,transitions,motion-graphics} folders, turns shader files
// into registered custom transitions, Remotion MG files into templates, and
// renders HyperFrames compositions into media-pool videos.
import type { Tpl } from '../types';
import type { AudioAsset } from '../audio/library';
import { registerCustomTransition, type CustomTransitionDef, type CustomTransitionProp } from '../gl/customTransitions';
import { validateTransitionShaderSource } from '../agent/tools/shader-tools';
import type { MobileUploadRecord } from '../media/mobileUploadApi';

export type LocalAssetKind = 'sfx' | 'music' | 'transitions' | 'motion-graphics';

export interface LocalAssetEntry {
  id: string;
  kind: LocalAssetKind;
  name: string;
  url: string;
  category: string;
  bytes: number;
  modifiedAt: number;
  engine?: 'remotion' | 'hyperframes';
  meta: Record<string, unknown>;
}

export type LocalAssetLibrary = Record<LocalAssetKind, LocalAssetEntry[]>;

export const EMPTY_LOCAL_LIBRARY: LocalAssetLibrary = { sfx: [], music: [], transitions: [], 'motion-graphics': [] };

/** Transition / template ids carry the plugin: prefix so the existing drop + apply paths resolve them. */
export const localAssetPluginId = (entry: Pick<LocalAssetEntry, 'id'>): string => `plugin:local/${entry.id}`;

export async function fetchLocalAssets(): Promise<LocalAssetLibrary> {
  const res = await fetch('/api/local-assets');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json() as Partial<LocalAssetLibrary>;
  return { ...EMPTY_LOCAL_LIBRARY, ...body };
}

const textCache = new Map<string, Promise<string>>();

/** Fetch an asset's source text (cached by url + mtime). */
export function fetchAssetText(entry: LocalAssetEntry): Promise<string> {
  const key = `${entry.url}@${entry.modifiedAt}`;
  let pending = textCache.get(key);
  if (!pending) {
    pending = fetch(entry.url).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
    pending.catch(() => textCache.delete(key));
    textCache.set(key, pending);
  }
  return pending;
}

export function audioSeconds(entry: LocalAssetEntry): number {
  const seconds = Number(entry.meta.seconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 1;
}

export function localAudioAsset(entry: LocalAssetEntry, fps: number): AudioAsset {
  return {
    id: `local_${entry.id}`,
    name: entry.name,
    category: entry.kind === 'music' ? 'music' : 'sfx',
    src: entry.url,
    durationInFrames: Math.max(1, Math.round(audioSeconds(entry) * fps)),
  };
}

function transitionProps(meta: Record<string, unknown>): CustomTransitionProp[] {
  if (!Array.isArray(meta.props)) return [];
  const props: CustomTransitionProp[] = [];
  for (const raw of meta.props as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const key = typeof p.key === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.key) ? p.key : null;
    const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
    if (!key) continue;
    const min = num(p.min, 0);
    const max = num(p.max, 1);
    props.push({
      key,
      label: typeof p.label === 'string' ? p.label : key,
      default: Math.min(max, Math.max(min, num(p.default, min))),
      min,
      max,
      ...(typeof p.step === 'number' ? { step: p.step } : {}),
    });
  }
  return props;
}

/** Load + validate a shader file and register it as a custom transition; returns the def or an error. */
export async function registerLocalTransition(entry: LocalAssetEntry): Promise<CustomTransitionDef | { error: string }> {
  const frag = await fetchAssetText(entry);
  const problem = validateTransitionShaderSource(frag);
  if (problem) return { error: problem };
  return registerCustomTransition({ id: localAssetPluginId(entry), label: entry.name, frag, props: transitionProps(entry.meta) });
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Build an MG template from a Remotion component file. */
export async function localMgTemplate(entry: LocalAssetEntry): Promise<Tpl> {
  const code = await fetchAssetText(entry);
  const props = entry.meta.props && typeof entry.meta.props === 'object' && !Array.isArray(entry.meta.props)
    ? entry.meta.props as Record<string, unknown>
    : {};
  return {
    id: localAssetPluginId(entry),
    name: entry.name,
    category: '本地素材',
    description: typeof entry.meta.description === 'string' ? entry.meta.description : undefined,
    width: positive(entry.meta.width, 1920),
    height: positive(entry.meta.height, 1080),
    fps: positive(entry.meta.fps, 30),
    durationInFrames: positive(entry.meta.durationInFrames, 150),
    props,
    propSchema: [],
    thumb: null,
    code,
  };
}

/** Render a HyperFrames composition (library id or raw HTML) into the uploads folder. */
export async function renderHyperframes(input: { id?: string; html?: string; name: string; fps?: number }): Promise<MobileUploadRecord> {
  const res = await fetch('/api/mg/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, transparent: true }),
  });
  const body = await res.json().catch(() => ({})) as { upload?: MobileUploadRecord; error?: string };
  if (!res.ok || !body.upload) throw new Error(body.error || `HTTP ${res.status}`);
  return body.upload;
}

export interface GeneratedMotionGraphic {
  engine: 'remotion' | 'hyperframes';
  source: string;
  problems: string[];
  seconds: number;
  width: number;
  height: number;
}

/** Ask Claude (server-side, Anthropic SDK) for a motion graphic. */
export async function generateMotionGraphic(input: {
  engine: 'remotion' | 'hyperframes';
  prompt: string;
  width: number;
  height: number;
  seconds: number;
  previous?: string;
}, signal?: AbortSignal): Promise<GeneratedMotionGraphic> {
  const res = await fetch('/api/mg/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  const body = await res.json().catch(() => ({})) as Partial<GeneratedMotionGraphic> & { error?: string };
  if (!res.ok || typeof body.source !== 'string') throw new Error(body.error || `HTTP ${res.status}`);
  return body as GeneratedMotionGraphic;
}

/** Save a generated MG into assets/motion-graphics/generated. */
export async function saveGeneratedMotionGraphic(input: {
  name: string;
  engine: 'remotion' | 'hyperframes';
  source: string;
  meta: Record<string, unknown>;
}): Promise<string> {
  const res = await fetch('/api/local-assets/motion-graphics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({})) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error || `HTTP ${res.status}`);
  return body.id;
}

// ── Shared store: one load feeds the Assets browser, the editor's template list
// (so the agent's browse_library / edit_item see local MGs) and local audio lookup.

export interface LocalLibrarySnapshot {
  library: LocalAssetLibrary;
  /** Remotion MG files as templates, keyed by library entry id. */
  templates: Record<string, Tpl>;
  /** Shader registration result per transition entry id. */
  transitions: Record<string, CustomTransitionDef | { error: string }>;
  loading: boolean;
  error: string | null;
}

let snapshot: LocalLibrarySnapshot = { library: EMPTY_LOCAL_LIBRARY, templates: {}, transitions: {}, loading: false, error: null };
let inflight: Promise<void> | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: Partial<LocalLibrarySnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

export function localLibrarySnapshot(): LocalLibrarySnapshot {
  return snapshot;
}

export function subscribeLocalLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Load (or reload with force) the local library; concurrent callers share one request. */
export function loadLocalLibrary(force = false): Promise<void> {
  if (inflight) return inflight;
  if (loaded && !force) return Promise.resolve();
  publish({ loading: true, error: null });
  inflight = (async () => {
    try {
      const library = await fetchLocalAssets();
      const transitions = Object.fromEntries(await Promise.all(library.transitions.map(async (entry) => (
        [entry.id, await registerLocalTransition(entry).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))] as const
      ))));
      const templates = Object.fromEntries((await Promise.all(library['motion-graphics']
        .filter((entry) => entry.engine === 'remotion')
        .map(async (entry) => [entry.id, await localMgTemplate(entry).catch(() => null)] as const)))
        .filter((pair): pair is readonly [string, Tpl] => pair[1] !== null));
      loaded = true;
      publish({ library, templates, transitions, loading: false });
    } catch (e) {
      publish({ loading: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Local sfx / music entry by its library id ("sfx/whoosh/air-whoosh.mp3"). */
export function localAudioEntry(id: string): LocalAssetEntry | undefined {
  return [...snapshot.library.sfx, ...snapshot.library.music].find((entry) => entry.id === id);
}
