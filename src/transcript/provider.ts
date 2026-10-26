// Transcription runs on-device (Whisper); no audio leaves the machine.
import type { TranscriptResult, TranscriptionProviderId } from './types';
import type {
  TranscribeOptions,
  TranscriptionCheckpointWriter,
  TranscriptionJobStatus,
  TranscriptionResumeCheckpoint,
} from './transcription-source';
import { localTranscribePathResumable } from './local-asr';
import { getLocale } from '../i18n/locale';

export const TRANSCRIPTION_PROVIDER_KEY = 'cc.transcriptionProvider';
export const TRANSCRIPTION_LANGUAGE_KEY = 'cc.transcriptionLanguage';
export const TRANSCRIPTION_DIARIZATION_KEY = 'cc.transcriptionDiarization';
export const TRANSCRIPTION_PROVIDER_CHANGE_EVENT = 'openchatcut:transcription-provider-change';

/** Ingestion auto-transcribe policy: `local`/`all` transcribe new media with
 *  the on-device engine; `off` never does. */
export const AUTO_TRANSCRIBE_INGEST_KEY = 'cc.autoTranscribeIngest';
export type AutoTranscribeIngestSetting = 'off' | 'local' | 'all';

export function autoTranscribeIngestSetting(): AutoTranscribeIngestSetting {
  try {
    const value = localStorage.getItem(AUTO_TRANSCRIBE_INGEST_KEY);
    if (value === 'off' || value === 'all') return value;
  } catch {
    // SSR / private browsing: fall through to the default.
  }
  return 'local';
}

export function shouldAutoTranscribeIngest(
  provider: TranscriptionProviderId = preferredTranscriptionProvider(),
): boolean {
  const setting = autoTranscribeIngestSetting();
  return setting === 'all' || (setting === 'local' && provider === 'local');
}

export function setAutoTranscribeIngest(setting: AutoTranscribeIngestSetting): void {
  try {
    localStorage.setItem(AUTO_TRANSCRIBE_INGEST_KEY, setting);
  } catch {
    // Best-effort; the default stays in effect.
  }
}


export function preferredTranscriptionProvider(): TranscriptionProviderId {
  return 'local';
}

export function preferredTranscriptionLanguage(): string {
  try {
    const value = localStorage.getItem(TRANSCRIPTION_LANGUAGE_KEY)?.trim();
    if (value) return value;
  } catch {
    // SSR / private browsing: fall through to the default.
  }
  // No explicit choice: transcribe in the interface language.
  return getLocale();
}

export function preferredTranscriptionDiarization(): boolean {
  try {
    const value = localStorage.getItem(TRANSCRIPTION_DIARIZATION_KEY);
    if (value === '0') return false;
    if (value === '1') return true;
  } catch {
    // SSR / private browsing: fall through to the default.
  }
  return true;
}

export function setPreferredTranscriptionProvider(provider: TranscriptionProviderId): void {
  try {
    localStorage.setItem(TRANSCRIPTION_PROVIDER_KEY, provider);
    window.dispatchEvent(new Event(TRANSCRIPTION_PROVIDER_CHANGE_EVENT));
  } catch {
    // Best-effort; the default stays in effect.
  }
}

export type { TranscriptionJobStatus, TranscriptionResumeCheckpoint, TranscriptionCheckpointWriter, TranscribeOptions };
export { TranscriptionError, extractAudioForAsr, transcriptionSourceForPath } from './transcription-source';

/**
 * Route one immutable provider attempt. Callers that persist work pass the
 * provider captured at job start so a settings change cannot switch it midway.
 */
export async function transcribePathResumable(
  path: string,
  resume: TranscriptionResumeCheckpoint,
  onCheckpoint: TranscriptionCheckpointWriter,
  onWait?: (note?: string) => void,
  opts: TranscribeOptions = {},
  provider: TranscriptionProviderId = preferredTranscriptionProvider(),
): Promise<TranscriptResult> {
  const capturedOptions: TranscribeOptions = {
    ...opts,
    languageCode: opts.languageCode ?? preferredTranscriptionLanguage(),
    diarize: opts.diarize ?? preferredTranscriptionDiarization(),
  };
  void provider;
  return localTranscribePathResumable(path, resume, onCheckpoint, onWait, capturedOptions);
}

export async function transcribePath(
  path: string,
  onWait?: (note?: string) => void,
  opts: TranscribeOptions = {},
  provider: TranscriptionProviderId = preferredTranscriptionProvider(),
): Promise<TranscriptResult> {
  return transcribePathResumable(path, {}, () => {}, onWait, opts, provider);
}
