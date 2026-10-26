import type { SettingsField, SettingsGroup, SettingsVendorPage } from './settingsFields';

const COMMON_TRANSCRIPTION_FIELDS: readonly SettingsField[] = [
  {
    name: 'TRANSCRIPTION_LANGUAGE',
    label: '转写语言',
    kind: 'select',
    defaultLabel: '跟随界面语言',
    options: [
      { value: 'zh', label: '中文（zh）' },
      { value: 'en', label: '英语（en）' },
      { value: 'it', label: '意大利语（it）' },
      { value: 'ja', label: '日语（ja）' },
      { value: 'ko', label: '韩语（ko）' },
      { value: 'es', label: '西班牙语（es）' },
      { value: 'fr', label: '法语（fr）' },
      { value: 'de', label: '德语（de）' },
      { value: 'ru', label: '俄语（ru）' },
      { value: 'pt', label: '葡萄牙语（pt）' },
    ],
  },
  {
    name: 'TRANSCRIPTION_DIARIZATION',
    label: '说话人分离',
    kind: 'select',
    defaultLabel: '启用',
    options: [
      { value: '1', label: '启用' },
      { value: '0', label: '停用' },
    ],
  },
  {
    name: 'AUTO_TRANSCRIBE_INGEST',
    label: '导入后自动转写',
    kind: 'select',
    defaultLabel: '仅本地引擎（免费）',
    note: '素材进入媒体池后是否立即转写。本地 Whisper 免费且在本机运行。',
    options: [
      { value: 'off', label: '关闭（手动转写）' },
      { value: 'local', label: '仅本地引擎（免费）' },
    ],
  },
];

const transcriptionPage = (
  provider: string,
  vendor: SettingsVendorPage['vendor'],
  title: string,
  fields: readonly SettingsField[],
  note?: string,
): SettingsVendorPage => ({
  key: `transcription/${provider}`,
  vendor,
  title,
  note,
  fields: [...fields, ...COMMON_TRANSCRIPTION_FIELDS],
});

const localTranscriptionPage = transcriptionPage('local', 'localasr', '本地模型（whisper）', [
  {
    name: 'LOCAL_ASR_MODEL',
    label: '默认模型',
    kind: 'select',
    defaultLabel: '自动（按设备内存选择）',
    note: '选中的模型需已下载；未选择时按设备内存自动挑选（内存 ≥6GB 用 Small，否则 Base）。',
    options: [
      { value: 'tiny', label: 'Whisper Tiny（约 100MB · 最快）' },
      { value: 'base', label: 'Whisper Base（约 80MB · 均衡）' },
      { value: 'small', label: 'Whisper Small（约 250MB · 推荐）' },
      { value: 'medium', label: 'Whisper Medium（约 1.1GB · 精度最高）' },
      { value: 'large-v3-turbo', label: 'Whisper Large v3 Turbo（约 1.1GB · 多语言最强）' },
    ],
  },
], '转写在本机完成：免费、离线、素材不出本机。模型需先下载，下载与删除在 本地模型 → 本地转写 页（点下方按钮前往）。自动选择设备优势后端：WebGPU 不可用时回退 CPU。本地转写不含说话人分离（全部归为同一位说话人）。');

/** The page with the local Whisper model list (download / delete). */
export const LOCAL_ASR_SETTINGS_ROUTE = 'local/asr';

// The model list lives on 本地模型 → 本地转写. This page used to promise it
// "below" with no way to get there, while runtime errors sent users here (#126).
export const localAsrPage: SettingsVendorPage = {
  ...localTranscriptionPage,
  noteAction: { label: '下载 / 管理本地模型', route: LOCAL_ASR_SETTINGS_ROUTE },
};

/** Transcription runs on-device only, so the group has one page and no route picker. */
export const TRANSCRIPTION_SETTINGS_GROUP: SettingsGroup = {
  key: 'transcription',
  title: '转写 / 口播剪辑',
  hint: 'transcribe_track · 词级字幕、清口水、删词。',
  vendors: [localAsrPage],
};

export const ROUTE_NEEDS: Record<string, readonly (readonly string[])[]> = {
  local: [[]],
};
