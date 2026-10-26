// External-skill dependency detection: installed custom skills (from GitHub)
// are written for their original environment (Codex, Claude Code, …) and may
// name services OpenChatCut does not expose the same way. This module scans a
// skill's text for service keywords and maps each hit onto a local capability
// so the system prompt can tell the agent what to substitute and what is
// missing — instead of blindly following a foreign workflow.
import type { CapabilityKey } from '../capabilities';
import { currentCaps } from '../capabilities';
import type { SkillDefinition } from './skill-types';

export type SkillDependencyKind = CapabilityKey | 'runtime' | 'ffmpeg';

export interface SkillDependency {
  kind: SkillDependencyKind;
  service: string;
  keyword: string;
  hits: number;
}

interface Rule {
  kind: SkillDependencyKind;
  service: string;
  keywords: string[];
}

const RULES: Rule[] = [
  {
    kind: 'transcription',
    service: 'on-device transcription (语音转写)',
    keywords: ['whisper', 'transcription', '转写'],
  },
  {
    kind: 'web',
    service: 'web extraction (网页抓取/搜索)',
    keywords: ['firecrawl', 'web search', '网页搜索', 'web scraper', '爬取', 'web_browser'],
  },
  {
    kind: 'sandbox',
    service: 'sandbox execution (run_code / ffmpeg / node / python)',
    keywords: ['run_code', 'e2b', 'sandbox', 'node script', 'python script', 'pip install', 'npm install', 'uvx ', 'uv run'],
  },
  {
    kind: 'runtime',
    service: 'external agent runtime (Claude Code / …)',
    keywords: ['codex', 'claude code', 'openclaw', 'cursor', '~/.codex', 'desktop and cli'],
  },
  {
    kind: 'ffmpeg',
    service: 'ffmpeg / ffprobe',
    keywords: ['ffmpeg', 'ffprobe'],
  },
];

/** Scan a skill's text (SKILL.md body + description) for service dependencies. */
export function detectSkillDependencies(text: string): SkillDependency[] {
  const lower = text.toLowerCase();
  const found: SkillDependency[] = [];
  for (const rule of RULES) {
    let hits = 0;
    let keyword = '';
    for (const candidate of rule.keywords) {
      const count = lower.split(candidate).length - 1;
      if (count > 0) {
        hits += count;
        if (!keyword) keyword = candidate;
      }
    }
    if (hits > 0) found.push({ kind: rule.kind, service: rule.service, keyword, hits });
  }
  return found.sort((a, b) => b.hits - a.hits);
}

const CAP_LABEL: Record<CapabilityKey, string> = {
  stock: 'stock media (search_stock_media)',
  transcription: 'transcription (transcribe_track)',
  sandbox: 'sandbox (run_code)',
  web: 'web extraction (web_browser)',
};

/**
 * Adaptation block for the agent: which declared dependencies map onto
 * configured local capabilities (use them), which are missing (do not call
 * them; tell the user and point at Settings), and which are environment notes
 * (external agent runtime → execute the steps with this environment's tools).
 * Only meaningful for custom (externally installed) skills; built-ins are
 * already written against local capabilities.
 */
export function skillDependencyPrompt(
  skill: SkillDefinition,
  text: string,
  caps: Record<CapabilityKey, boolean> = currentCaps(),
): string {
  if (skill.source !== 'custom') return '';
  const deps = detectSkillDependencies(text);
  if (deps.length === 0) return '';
  const lines: string[] = [];
  const missing: string[] = [];
  for (const dep of deps) {
    if (dep.kind === 'ffmpeg') {
      lines.push(`- ${dep.service}: available here (local/sandbox) — use it as the skill describes.`);
      continue;
    }
    if (dep.kind === 'runtime') {
      lines.push(
        `- ${dep.service}: this skill was written for that environment (found "${dep.keyword}"). `
        + 'You are the OpenChatCut built-in agent: run the same deterministic steps with THIS environment\'s tools '
        + '(editor tools for timeline/media, run_skill_script for the skill\'s own scripts/… locally, run_code sandbox for generic code). '
        + 'Do not pretend an external agent exists; adapt paths like ~/.codex/skills/… to the skill\'s installed location.',
      );
      continue;
    }
    if (dep.kind === 'stock') {
      lines.push(`- ${dep.service}: if the workflow needs stock media, follow the available-capabilities list above.`);
      continue;
    }
    if (caps[dep.kind]) {
      lines.push(`- ${dep.service}: the skill names its own service (e.g. "${dep.keyword}"); THIS app has ${CAP_LABEL[dep.kind]} configured — use the local tool instead of the skill's foreign service.`);
    } else {
      missing.push(dep.service);
      lines.push(`- ${dep.service}: NOT configured in this app — do not call ${CAP_LABEL[dep.kind]}; it returns "not configured".`);
    }
  }
  return [
    '',
    '<selected_skill_adaptation>',
    `The user selected custom skill "${skill.slug}", written for a different environment. Dependencies were auto-detected from its content and checked against THIS app's configured capabilities:`,
    ...lines,
    missing.length > 0
      ? 'Before starting, tell the user in one sentence which services are missing and ask them to configure them (Settings → the matching capability page), or to approve an alternative path you propose.'
      : 'Before starting, tell the user in one sentence that their foreign services are substituted with this app\'s configured equivalents.',
    'Never claim you used a service that is not configured here.',
    '</selected_skill_adaptation>',
  ].join('\n');
}
