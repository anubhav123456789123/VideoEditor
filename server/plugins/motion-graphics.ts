// Local asset library + Motion Graphics tab routes.
//   GET  /api/local-assets                  list assets/{sfx,music,transitions,motion-graphics}
//   POST /api/local-assets/motion-graphics  save a generated MG into assets/motion-graphics/generated
//   POST /api/mg/generate                   ask Claude for a Remotion component or a HyperFrames composition
//   POST /api/mg/render                     render a HyperFrames composition into the uploads folder
//   GET  /api/mg/gsap.js                    GSAP for in-editor HyperFrames previews
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';
import {
  readLocalAssetText,
  resolveLocalAsset,
  saveMotionGraphic,
  scanLocalAssetLibrary,
  type LocalAssetEntry,
} from '../local-assets.ts';
import { generateClaudeText, ClaudeUnavailableError } from '../motion-graphics/claude.ts';
import { compositionSeconds, lintComposition, renderHyperframes } from '../motion-graphics/hyperframes.ts';
import { hyperframesSystemPrompt, remotionMgSystemPrompt, remotionTabGuidance, stripCodeFence } from '../../shared/mg-prompts.ts';
import { probeMediaFile } from './probe-media.ts';
import { readJsonBody, sendJson } from './export-http.ts';
import { resolveProductAsset } from '../product-assets.ts';

type Engine = 'remotion' | 'hyperframes';
const require = createRequire(import.meta.url);
const durationCache = new Map<string, number | null>();

async function audioSeconds(entry: LocalAssetEntry): Promise<number | null> {
  const key = `${entry.url}@${entry.modifiedAt}`;
  if (durationCache.has(key)) return durationCache.get(key)!;
  const file = resolveProductAsset(entry.url);
  let seconds: number | null = null;
  if (file) {
    try {
      const probe = await probeMediaFile(file);
      const value = Number((probe.format as { duration?: unknown } | undefined)?.duration);
      seconds = Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      seconds = null;
    }
  }
  durationCache.set(key, seconds);
  return seconds;
}

async function listLibrary(): Promise<unknown> {
  const library = scanLocalAssetLibrary();
  for (const entry of [...library.sfx, ...library.music]) {
    entry.meta = { ...entry.meta, seconds: entry.meta.seconds ?? await audioSeconds(entry) };
  }
  return library;
}

function engineOf(value: unknown): Engine {
  return value === 'hyperframes' ? 'hyperframes' : 'remotion';
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

async function generate(body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const prompt = String(body.prompt ?? '').trim();
  if (!prompt) return { status: 400, body: { error: 'prompt is required' } };
  const engine = engineOf(body.engine);
  const width = clampInt(body.width, 16, 4096, 1920);
  const height = clampInt(body.height, 16, 4096, 1080);
  const seconds = clampInt(body.seconds, 1, 60, 5);
  const previous = typeof body.previous === 'string' ? body.previous.slice(0, 200_000) : '';
  const request = previous
    ? `Revise this motion graphic. Keep what works and apply the change.\n\nChange: ${prompt}\n\nCurrent source:\n${previous}`
    : prompt;
  const system = engine === 'hyperframes'
    ? hyperframesSystemPrompt({ width, height, seconds })
    : remotionMgSystemPrompt() + remotionTabGuidance({ width, height, seconds });
  const source = stripCodeFence(await generateClaudeText({ system, prompt: request, signal }));
  if (!source) return { status: 502, body: { error: 'Claude returned an empty motion graphic' } };
  if (engine === 'hyperframes') {
    const problems = await lintComposition(source);
    return { status: 200, body: { engine, source, problems, seconds: compositionSeconds(source) ?? seconds, width, height } };
  }
  return { status: 200, body: { engine, source, problems: [], seconds, width, height } };
}

function route(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  tag: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handler(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${tag}] ${message}`);
      if (!res.headersSent) sendJson(res, error instanceof ClaudeUnavailableError ? 409 : 500, { error: message });
    });
  };
}

export function motionGraphicsPlugin(): Plugin {
  return {
    name: 'openchatcut-motion-graphics',
    configureServer(server) {
      server.middlewares.use('/api/local-assets/motion-graphics', route(async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'use POST' });
        const body = (await readJsonBody(req)) as Record<string, unknown> | null;
        const source = String(body?.source ?? '');
        const name = String(body?.name ?? '').trim() || 'Motion graphic';
        if (!source.trim() || source.length > 400_000) return sendJson(res, 400, { error: 'source is required (max 400 KB)' });
        const meta = body?.meta && typeof body.meta === 'object' && !Array.isArray(body.meta) ? body.meta as Record<string, unknown> : {};
        const id = await saveMotionGraphic({ name, engine: engineOf(body?.engine), source, meta });
        sendJson(res, 200, { ok: true, id });
      }, 'local-assets'));
      server.middlewares.use('/api/local-assets', route(async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'use GET' });
        sendJson(res, 200, await listLibrary());
      }, 'local-assets'));
      server.middlewares.use('/api/mg/generate', route(async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'use POST' });
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableFinished) controller.abort(); });
        const body = ((await readJsonBody(req)) ?? {}) as Record<string, unknown>;
        const result = await generate(body, controller.signal) as { status: number; body: unknown };
        sendJson(res, result.status, result.body);
      }, 'mg-generate'));
      server.middlewares.use('/api/mg/gsap.js', route(async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'use GET' });
        // GSAP for in-editor HyperFrames previews (inlined into a sandboxed srcdoc iframe).
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.end(await readFile(require.resolve('gsap/dist/gsap.min.js')));
      }, 'mg-gsap'));
      server.middlewares.use('/api/mg/render', route(async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'use POST' });
        const body = ((await readJsonBody(req)) ?? {}) as Record<string, unknown>;
        let html = typeof body.html === 'string' ? body.html : '';
        if (!html && typeof body.id === 'string') {
          const file = resolveLocalAsset(body.id);
          if (!file || !file.endsWith('.html')) return sendJson(res, 404, { error: 'composition not found' });
          html = readLocalAssetText(file);
        }
        if (!html.trim()) return sendJson(res, 400, { error: 'html or id is required' });
        const upload = await renderHyperframes({
          html,
          name: typeof body.name === 'string' ? body.name : undefined,
          fps: Number(body.fps) || 30,
          transparent: body.transparent !== false,
        });
        sendJson(res, 200, { ok: true, upload });
      }, 'mg-render'));
    },
  };
}
