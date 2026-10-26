// HeyGen HyperFrames rendering for the Motion Graphics tab: an HTML composition
// (HTML + CSS + paused GSAP timeline) is written to a scratch project next to a
// local GSAP copy, rendered frame-by-frame by @hyperframes/producer in headless
// Chrome, and encoded into the uploads folder so it can join the media pool like
// any other video. Overlays render as ProRes 4444 with alpha (.mov), the same
// intermediate the editor uses when baking MG clips.
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintHyperframeHtml } from '@hyperframes/lint';
import { uploadDir } from '../media-dir.ts';

const require = createRequire(import.meta.url);
const MAX_HTML_BYTES = 400_000;
const MAX_SECONDS = 60;

export interface HyperframesRenderRequest {
  html: string;
  name?: string;
  fps?: number;
  transparent?: boolean;
}

export interface RenderedUpload {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  path: string;
  createdAt: number;
}

/** Point every GSAP <script> at the local copy and drop other external scripts. */
export function localizeScripts(html: string): string {
  return html.replace(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, (_tag, src: string) => (
    /gsap/i.test(src) ? '<script src="gsap.min.js"></script>' : ''
  ));
}

/** Composition duration from `tl.set({}, {}, N)` or the root data-duration, clamped. */
export function compositionSeconds(html: string): number | null {
  const set = [...html.matchAll(/\.set\(\s*\{\s*\}\s*,\s*\{\s*\}\s*,\s*([\d.]+)\s*\)/g)].map((m) => Number(m[1]));
  const value = set.length ? Math.max(...set) : null;
  return value && Number.isFinite(value) ? Math.min(MAX_SECONDS, value) : null;
}

/** Structural problems that would make the render fail or come out empty. */
export async function lintComposition(html: string): Promise<string[]> {
  const problems: string[] = [];
  if (!/data-composition-id\s*=/.test(html)) problems.push('missing data-composition-id');
  if (!/__timelines/.test(html)) problems.push('the GSAP timeline is not registered on window.__timelines');
  try {
    const result = await lintHyperframeHtml(html);
    for (const finding of result.findings) {
      if (finding.severity === 'error') problems.push(finding.message);
    }
  } catch {
    // The linter is advisory; the render itself is the final check.
  }
  return problems;
}

let queue: Promise<unknown> = Promise.resolve();

async function renderOnce(request: HyperframesRenderRequest): Promise<RenderedUpload> {
  const html = localizeScripts(request.html);
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error('composition is too large');
  const { createRenderJob, executeRenderJob, resolveConfig } = await import('@hyperframes/producer');
  const project = await mkdtemp(join(tmpdir(), 'openchatcut-hyperframes-'));
  try {
    await writeFile(join(project, 'index.html'), html, 'utf8');
    await copyFile(require.resolve('gsap/dist/gsap.min.js'), join(project, 'gsap.min.js'));
    const transparent = request.transparent !== false;
    const format = transparent ? 'mov' : 'mp4';
    const file = `hyperframes-${randomUUID()}.${format}`;
    const output = join(uploadDir(), file);
    const chromePath = process.env.CC_BROWSER_EXECUTABLE || undefined;
    const job = createRenderJob({
      fps: request.fps === 24 || request.fps === 60 ? request.fps : 30,
      quality: 'standard',
      format,
      ...(chromePath ? { producerConfig: resolveConfig({ chromePath }) } : {}),
    });
    await executeRenderJob(job, project, output);
    if (job.status !== 'complete') throw new Error(job.error || `render ${job.status}`);
    const info = await stat(output);
    const base = (request.name?.trim() || 'Motion graphic').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80);
    return {
      id: randomUUID(),
      name: `${base}.${format}`,
      mime: transparent ? 'video/quicktime' : 'video/mp4',
      bytes: info.size,
      path: `/media/uploads/${file}`,
      createdAt: Date.now(),
    };
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

/** Render one composition; renders run one at a time (each one drives a browser). */
export function renderHyperframes(request: HyperframesRenderRequest): Promise<RenderedUpload> {
  const run = queue.then(() => renderOnce(request), () => renderOnce(request));
  queue = run.catch(() => undefined);
  return run;
}
