import type { AgentToolSchema } from '../tool-schema';

/** Export (video / audio / subtitles / NLE XML) and async job progress schemas. */
export const GENERATE_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: 'track_progress',
    description: 'Inspect or wait for asynchronous editor jobs.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'wait'], description: 'status checks immediately; wait polls until done or the timeout.' },
        timeoutSeconds: { type: 'number', minimum: 0, maximum: 3600, description: 'wait timeout; defaults to 90 seconds.' },
      },
      required: ['action', 'target'],
    },
  },
  {
    name: 'submit_export',
    description: [
      'Export the active timeline synchronously as MP4/WebM video, MP3/WAV audio, SRT/TXT subtitles,',
      'or an FCPXML project (format=xml) for Premiere / Resolve / FCP.',
      'When MG/captions reference fonts the renderer cannot load, the first call returns unsupportedFonts',
      '— relay to the user and retry with confirmFontFallback=true only after they accept.',
      'For XML, pass nleFormat=fcp_xml (default, Premiere) or fcp_xml_resolve (DaVinci Resolve).',
      'Optional frame boundaries use a half-open [startFrame, endFrameExclusive) range.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['video', 'audio', 'subtitles', 'xml'] },
        codec: { type: 'string', enum: ['h264', 'vp8', 'mp3', 'wav'], description: 'Video: h264 (default) or vp8. Audio: mp3 (default) or wav.' },
        subtitleFormat: { type: 'string', enum: ['srt', 'txt'], description: 'Defaults to srt.' },
        captionTrackId: { type: 'string', description: 'For subtitle export: C1/C2 alias or stable caption track id. Defaults to C1.' },
        nleFormat: {
          type: 'string',
          enum: ['fcp_xml', 'fcp_xml_resolve'],
          description: 'NLE XML format for format=xml. Defaults to fcp_xml (Premiere). Use fcp_xml_resolve for DaVinci Resolve.',
        },
        name: { type: 'string', description: 'Download filename.' },
        fps: {
          type: 'number',
          description: 'Video output fps: 24|25|30|50|60. Omit to match timeline. Frame counts stay; real duration scales.',
        },
        resolution: {
          type: 'string',
          enum: ['480p', '720p', '1080p'],
          description: 'Video max-height ladder (default timeline size). Scales width to keep aspect.',
        },
        videoBitrate: {
          type: 'integer',
          minimum: 1_000_000,
          maximum: 80_000_000,
          description: 'Video only. Exact output bitrate in bits per second; omit for the renderer default.',
        },
        timelineId: {
          type: 'string',
          description: 'Export a non-active timeline by id/prefix without switching (video/audio/xml).',
        },
        startFrame: { type: 'integer', minimum: 0 },
        endFrameExclusive: { type: 'integer', minimum: 1 },
        startSeconds: { type: 'number', minimum: 0, description: 'Legacy; prefer startFrame.' },
        endSeconds: { type: 'number', minimum: 0, description: 'Legacy; prefer endFrameExclusive.' },
        confirmFontFallback: {
          type: 'boolean',
          description: 'Required true when export would burn unsupported fonts. First call without it returns the unsupported list.',
        },
        motionGraphicRenderKeys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advanced XML export: render keys returned by export_motion_graphic_prores with filenameMode=xml. Matching MG clips become media references; other MG clips stay placeholders.',
        },
      },
    },
  },
];

export const GENERATE_TOOL_NAMES = new Set(GENERATE_TOOL_SCHEMAS.map((tool) => tool.name));
