// Transcription source handling shared by the on-device recogniser: compact
// speech-track extraction (POST /api/extract-audio), local-first source
// loading, and the resumable job checkpoint shape.
import { getMediaBlob } from '../persist/mediaBlobStore';

/** Prefer extract for these (video always; large pure-audio too). */
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v|avi|mpeg|mpg)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;
/** Pure audio above this still gets re-encoded smaller for ASR. */
const LARGE_AUDIO_BYTES = 40 * 1024 * 1024;

export class TranscriptionError extends Error {
  readonly code: 'source-unavailable' | 'service-unavailable' | 'no-audio';
  readonly detail?: string;

  constructor(
    code: 'source-unavailable' | 'service-unavailable' | 'no-audio',
    detail?: string,
  ) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'TranscriptionError';
    this.code = code;
    this.detail = detail;
  }
}

export interface TranscribeOptions {
  /**
   * ISO-639-1 language code, or `auto` to detect the spoken language.
   */
  languageCode?: string | 'auto';
  /** Enable provider speaker diarization. Defaults to the existing enabled behavior. */
  diarize?: boolean;
  /**
   * Pre-extracted small ASR track path (from race-ahead extract-audio).
   * When set, skip another extract-audio call.
   */
  asrPath?: string | null;
}

export type TranscriptionJobStatus =
  | 'uploaded'
  | 'submitted'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'error';

export interface TranscriptionResumeCheckpoint {
  uploadUrl?: string;
  providerJobId?: string;
  providerStatus?: TranscriptionJobStatus;
}

export type TranscriptionCheckpointWriter = (
  checkpoint: TranscriptionResumeCheckpoint,
) => void | Promise<void>;

/** Read a media source, falling back to the local-first IndexedDB copy. */
export async function loadTranscriptionSource(path: string): Promise<Blob> {
  let responseError: Error | null = null;
  try {
    const res = await fetch(path);
    const isHtml = (res.headers.get('content-type') ?? '').includes('text/html');
    if (res.ok && !isHtml) return res.blob();
    responseError = new Error(`HTTP ${res.status}`);
  } catch (error) {
    responseError = error instanceof Error ? error : new Error(String(error));
  }
  const cached = await getMediaBlob(path);
  if (cached?.blob.size) return cached.blob;
  throw new TranscriptionError('source-unavailable', responseError?.message);
}

/**
 * Ask the local server to extract a speech-sized audio file for ASR.
 * Returns the new /media/uploads/… path, or null if extract is unavailable.
 * Browser-local ASR sets `required` so a failed extract never falls through to
 * decoding an entire video master in the renderer.
 */
export async function extractAudioForAsr(src: string, required = false): Promise<string | null> {
  if (!src.startsWith('/media/uploads/')) {
    if (required) throw new TranscriptionError('source-unavailable', `音轨提取只支持工程素材：${src}`);
    return null;
  }
  try {
    const res = await fetch('/api/extract-audio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ src }),
    });
    if (res.status === 422) {
      const data = (await res.json().catch(() => null)) as { noAudio?: boolean } | null;
      if (data?.noAudio) throw new TranscriptionError('no-audio', `该片段没有音轨，无法转写：${src}`);
    }
    if (!res.ok) {
      if (!required) return null;
      const detail = await res.text().catch(() => '');
      throw new TranscriptionError(
        'service-unavailable',
        `音轨提取失败（HTTP ${res.status}${detail ? `：${detail.slice(0, 300)}` : ''}）`,
      );
    }
    const data = (await res.json()) as { path?: string; ok?: boolean };
    if (data.path?.startsWith('/media/uploads/')) return data.path;
    if (required) throw new TranscriptionError('service-unavailable', '音轨提取服务返回了无效路径');
    return null;
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    if (required) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new TranscriptionError('service-unavailable', `音轨提取失败：${detail}`);
    }
    return null;
  }
}

async function headBytes(path: string): Promise<number | null> {
  try {
    const r = await fetch(path, { method: 'HEAD', cache: 'no-store' });
    if (!r.ok) return null;
    const len = Number(r.headers.get('content-length') ?? '');
    return Number.isFinite(len) && len > 0 ? len : null;
  } catch {
    return null;
  }
}

/** Decide whether to run server-side audio extract before ASR. */
async function shouldExtractForAsr(path: string): Promise<boolean> {
  if (VIDEO_EXT.test(path)) return true;
  if (!AUDIO_EXT.test(path)) return true; // unknown extension: try extract (no-op-ish for pure audio)
  const bytes = await headBytes(path);
  return bytes != null && bytes > LARGE_AUDIO_BYTES;
}

/**
 * Resolve the media to transcribe. Videos (and large audio) first extract a
 * small speech track server-side so the recogniser never decodes a full master.
 * Pass opts.asrPath when extract already raced ahead of normalize/finalize.
 */
export async function transcriptionSourceForPath(
  path: string,
  opts: TranscribeOptions,
  requireExtractedAudio = false,
): Promise<string> {
  if (opts.asrPath && opts.asrPath.startsWith('/media/')) return opts.asrPath;
  if (await shouldExtractForAsr(path)) {
    const extracted = await extractAudioForAsr(path, requireExtractedAudio);
    if (extracted) return extracted;
  }
  return path;
}
