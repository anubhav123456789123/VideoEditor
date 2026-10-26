import type { AgentContext } from '../context';
import type { ProjectDoc, Timeline, TimelineState } from '../../editor/types';
import { submitSubtitleExport, type SubmitSubtitleExportArgs } from '../../generate/subtitles';
import { submitMediaExport, type SubmitMediaExportArgs } from '../../generate/media-export';
import { timelineToFcpxml, type NleFormat } from '../../export/fcpxml';
import { fcpxmlMediaLocations } from '../../export/exportMediaSources';
import { recordExport } from '../../persist/exportHistoryStore';
import { fontFallbackGate } from './font-tools';
import { refreshSystemFonts } from '../../fonts/systemFonts';

export type GenerateArgs = Record<string, unknown>;

type Handler = (args: GenerateArgs, ctx: AgentContext) => unknown | Promise<unknown>;

const safe = (handler: Handler): Handler => async (args, ctx) => {
  try {
    return await handler(args, ctx);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const structured = error as Error & { code: unknown; issues?: unknown };
      return { error: structured.message, code: structured.code, issues: structured.issues };
    }
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const frameRangeOf = (start?: number, end?: number): { start: number; end: number } | undefined =>
  typeof start === 'number' && typeof end === 'number' ? { start, end } : undefined;

interface ExportTarget {
  project: ProjectDoc;
  state: Timeline;
  timelineId: string;
}

function exportTarget(args: GenerateArgs, ctx: AgentContext): ExportTarget {
  const project = structuredClone(ctx.getDoc());
  const query = typeof args.timelineId === 'string' && args.timelineId.trim()
    ? args.timelineId.trim()
    : project.activeTimelineId;
  const state = project.timelines.find((timeline) => timeline.id === query || timeline.id.startsWith(query));
  if (!state) throw new Error(`timeline not found: ${args.timelineId ?? query}`);
  return { project, state, timelineId: state.id };
}

async function exportSubtitles(args: GenerateArgs, state: TimelineState): Promise<unknown> {
  const input: SubmitSubtitleExportArgs = {
    subtitleFormat: args.subtitleFormat as SubmitSubtitleExportArgs['subtitleFormat'], name: typeof args.name === 'string' ? args.name : undefined,
    captionTrackId: typeof args.captionTrackId === 'string' ? args.captionTrackId : undefined,
    startFrame: typeof args.startFrame === 'number' ? args.startFrame : undefined,
    endFrameExclusive: typeof args.endFrameExclusive === 'number' ? args.endFrameExclusive : undefined,
    startSeconds: typeof args.startSeconds === 'number' ? args.startSeconds : undefined,
    endSeconds: typeof args.endSeconds === 'number' ? args.endSeconds : undefined,
  };
  const result = await submitSubtitleExport(input, state);
  void recordExport({ name: result.name ?? `subtitles.${input.subtitleFormat ?? 'srt'}`, format: 'subtitles', frameRange: frameRangeOf(input.startFrame, input.endFrameExclusive), createdAt: Date.now() });
  return { ok: true, ...result };
}

async function exportMedia(args: GenerateArgs, target: ExportTarget, format: 'audio' | 'video'): Promise<unknown> {
  const fps = typeof args.fps === 'number' ? args.fps : undefined;
  if (fps != null && ![24, 25, 30, 50, 60].includes(fps)) throw new Error('fps must be one of 24, 25, 30, 50, 60');
  const resolution = args.resolution === '480p' || args.resolution === '720p' || args.resolution === '1080p' ? args.resolution : undefined;
  const input: SubmitMediaExportArgs = {
    format, codec: args.codec as SubmitMediaExportArgs['codec'], name: typeof args.name === 'string' ? args.name : undefined,
    startFrame: typeof args.startFrame === 'number' ? args.startFrame : undefined,
    endFrameExclusive: typeof args.endFrameExclusive === 'number' ? args.endFrameExclusive : undefined,
    startSeconds: typeof args.startSeconds === 'number' ? args.startSeconds : undefined,
    endSeconds: typeof args.endSeconds === 'number' ? args.endSeconds : undefined,
    fps,
    resolution,
    videoBitrate: typeof args.videoBitrate === 'number' ? args.videoBitrate : undefined,
  };
  const result = await submitMediaExport(input, target.project, target.timelineId);
  void recordExport({ name: result.name, format: result.format, codec: result.codec, sizeBytes: result.sizeBytes, frameRange: frameRangeOf(result.startFrame, result.endFrameExclusive), createdAt: Date.now() });
  return { ok: true, ...result };
}

async function exportXml(args: GenerateArgs, state: TimelineState): Promise<unknown> {
  const nleFormat: NleFormat = args.nleFormat === 'fcp_xml_resolve' ? 'fcp_xml_resolve' : 'fcp_xml';
  const keys = Array.isArray(args.motionGraphicRenderKeys)
    ? args.motionGraphicRenderKeys.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
    : [];
  const xml = timelineToFcpxml(state, { title: typeof args.name === 'string' ? args.name : undefined, nleFormat, motionGraphicRenderKeys: keys, ...await fcpxmlMediaLocations(state) });
  const base = (typeof args.name === 'string' && args.name ? args.name : 'timeline').replace(/\.(?:fcpxml|xml)$/i, '');
  const filename = `${base}.fcpxml`;
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Delayed revoke: revoking synchronously after click() can cut the download
  // off before the browser starts reading the blob (same pattern as exportFiles.ts).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  void recordExport({ name: filename, format: 'xml', sizeBytes: blob.size, createdAt: Date.now() });
  return { ok: true, format: 'xml', nleFormat, name: filename, sizeBytes: blob.size, motionGraphicRenderKeys: keys };
}

async function submitExportHandler(args: GenerateArgs, ctx: AgentContext): Promise<unknown> {
  const format = args.format ?? 'video';
  const target = exportTarget(args, ctx);
  if (format === 'video' || format === 'xml') {
    await refreshSystemFonts();
    const gate = fontFallbackGate(target.state, args.confirmFontFallback);
    if (gate) return gate;
  }
  if (format === 'subtitles') return exportSubtitles(args, target.state);
  if (format === 'audio' || format === 'video') return exportMedia(args, target, format);
  if (format === 'xml') return exportXml(args, target.state);
  return { error: 'format must be video, audio, subtitles, or xml' };
}

const COMMANDS: Record<string, Handler> = {
  submit_export: safe(submitExportHandler),
};

export function executeGenerateCommand(name: string, args: GenerateArgs, ctx: AgentContext): unknown | Promise<unknown> {
  const handler = COMMANDS[name];
  return handler ? handler(args, ctx) : { error: `generate tool not implemented: ${name}` };
}
