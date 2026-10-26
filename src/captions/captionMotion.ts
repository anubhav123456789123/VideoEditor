import type { CSSProperties } from 'react';
import type { CaptionMotionPreset, CaptionPage } from './types';

export const CAPTION_MOTION_OPTIONS = [
  { id: 'none', label: '无动效' },
  { id: 'fade-up', label: '淡入上浮' },
  { id: 'pop', label: '弹性入场' },
  { id: 'word-pop', label: '逐词弹出' },
  { id: 'karaoke-pulse', label: '卡拉 OK 脉冲' },
  { id: 'typewriter', label: '打字机' },
  { id: 'slide-up', label: '逐词上滑' },
  { id: 'blur-in', label: '模糊渐显' },
  { id: 'bounce', label: '跳动强调' },
] as const satisfies ReadonlyArray<{ id: CaptionMotionPreset; label: string }>;

const PRESETS = new Set<CaptionMotionPreset>(CAPTION_MOTION_OPTIONS.map((option) => option.id));
const EMPTY_STYLE: CSSProperties = Object.freeze({});
const PAGE_ENTER_MS = 180;
const PAGE_EXIT_MS = 120;
const WORD_ENTER_MS = 140;
/** Word-level presets animate each word; page-level presets animate the whole page. */
const WORD_PRESETS = new Set<CaptionMotionPreset>(['word-pop', 'karaoke-pulse', 'typewriter', 'slide-up', 'bounce']);

export function isCaptionMotionPreset(value: unknown): value is CaptionMotionPreset {
  return typeof value === 'string' && PRESETS.has(value as CaptionMotionPreset);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function easeOutCubic(value: number): number {
  const clamped = clamp01(value);
  return 1 - (1 - clamped) ** 3;
}

function easeOutBack(value: number): number {
  const clamped = clamp01(value);
  const overshoot = 1.70158;
  return 1 + (overshoot + 1) * (clamped - 1) ** 3 + overshoot * (clamped - 1) ** 2;
}

function pageOpacity(page: CaptionPage, timelineMs: number): number {
  const enter = easeOutCubic((timelineMs - page.start) / PAGE_ENTER_MS);
  const exit = clamp01((page.end - timelineMs) / PAGE_EXIT_MS);
  return Math.min(enter, exit);
}

/** Page-level motion. Nest this below the placement container so layout transforms remain intact. */
export function captionPageMotionStyle(
  preset: CaptionMotionPreset | undefined,
  page: CaptionPage,
  timelineMs: number,
): CSSProperties {
  if (!preset || preset === 'none' || WORD_PRESETS.has(preset)) {
    return EMPTY_STYLE;
  }
  const enter = easeOutCubic((timelineMs - page.start) / PAGE_ENTER_MS);
  const opacity = pageOpacity(page, timelineMs);
  if (preset === 'blur-in') {
    const blur = (1 - easeOutCubic((timelineMs - page.start) / (PAGE_ENTER_MS * 1.5))) * 8;
    return { opacity, filter: `blur(${Number(blur.toFixed(3))}px)`, transform: `scale(${Number((1.04 - enter * 0.04).toFixed(4))})`, transformOrigin: 'center' };
  }
  if (preset === 'fade-up') {
    return { opacity, transform: `translateY(${Number(((1 - enter) * 18).toFixed(3))}px)` };
  }
  const scale = easeOutBack((timelineMs - page.start) / PAGE_ENTER_MS);
  return { opacity, transform: `scale(${Number((0.78 + scale * 0.22).toFixed(4))})`, transformOrigin: 'center' };
}

/** Per-word motion derived only from absolute edited-timeline milliseconds. */
export function captionWordMotionStyle(
  preset: CaptionMotionPreset | undefined,
  word: Pick<CaptionPage['words'][number], 'start' | 'end'>,
  timelineMs: number,
): CSSProperties {
  if (!preset || !WORD_PRESETS.has(preset)) return EMPTY_STYLE;
  if (preset === 'typewriter') {
    // Words appear on their start time and keep their slot, so the line never reflows.
    return { opacity: timelineMs >= word.start ? 1 : 0 };
  }
  if (preset === 'slide-up') {
    const enter = easeOutCubic((timelineMs - word.start) / (WORD_ENTER_MS * 1.2));
    return {
      display: 'inline-block',
      opacity: timelineMs >= word.start ? enter : 0,
      transform: `translateY(${Number(((1 - enter) * 40).toFixed(3))}%)`,
    };
  }
  if (preset === 'bounce') {
    if (timelineMs < word.start || timelineMs > word.end) return EMPTY_STYLE;
    const progress = clamp01((timelineMs - word.start) / Math.min(240, Math.max(1, word.end - word.start)));
    return {
      display: 'inline-block',
      transform: `translateY(${Number((-Math.sin(progress * Math.PI) * 14).toFixed(3))}%)`,
    };
  }
  if (preset === 'word-pop') {
    const enter = easeOutBack((timelineMs - word.start) / WORD_ENTER_MS);
    const visible = timelineMs >= word.start;
    return {
      display: 'inline-block',
      opacity: visible ? 1 : 0,
      transform: `scale(${Number((0.72 + enter * 0.28).toFixed(4))})`,
      transformOrigin: 'center bottom',
    };
  }
  if (timelineMs < word.start || timelineMs > word.end) return EMPTY_STYLE;
  const duration = Math.max(1, word.end - word.start);
  const progress = clamp01((timelineMs - word.start) / duration);
  const scale = 1 + Math.sin(progress * Math.PI) * 0.08;
  return {
    display: 'inline-block',
    transform: `scale(${Number(scale.toFixed(4))})`,
    transformOrigin: 'center bottom',
  };
}
