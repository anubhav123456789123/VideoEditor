// Which key-gated capabilities are actually configured. The booleans are computed
// SERVER-SIDE in config/vite.config.ts (from .env.local) and injected via `define` as
// __CONFIGURED_CAPS__ — BOOLEANS ONLY, never any key value reaches the browser.
// The system prompt reads this so the agent plans around what's available instead
// of promising e.g. raw graph and only discovering "not configured" mid-execution.

export type CapabilityKey = 'stock' | 'transcription' | 'sandbox' | 'web';

/** Proposal confirmation mode for provider routing: 'manual' asks the user
 * before first use among several providers; 'auto' lets the agent pick. */
export type ApprovalMode = 'manual' | 'auto';

const ALL_OFF: Record<CapabilityKey, boolean> = {
  stock: false, transcription: false, sandbox: false, web: false,
};

// __CONFIGURED_CAPS__ is a Vite-`define` global (declared in src/globals.d.ts);
// undefined under tsx → all-false fallback. The typeof guard keeps the undefined
// case safe (a bare reference would ReferenceError outside Vite).
export const CONFIGURED_CAPS: Record<CapabilityKey, boolean> =
  typeof __CONFIGURED_CAPS__ !== 'undefined' ? (__CONFIGURED_CAPS__ as Record<CapabilityKey, boolean>) : ALL_OFF;

// Live capability snapshot from the server (GET /api/keys → caps), applied at app load and
// after the settings UI saves a key — so the agent perceives a runtime key change on its next
// message, without a dev-server restart (__CONFIGURED_CAPS__ is only the startup snapshot).
// Wins over the define once set.
let liveCaps: Record<CapabilityKey, boolean> | null = null;
export function applyLiveCaps(caps: Partial<Record<CapabilityKey, boolean>>): void {
  liveCaps = { ...ALL_OFF, ...caps };
}
export function currentCaps(): Record<CapabilityKey, boolean> {
  return liveCaps ?? CONFIGURED_CAPS;
}

// Per-KEY live status (GET /api/keys → keys, booleans only) — refines the manifest to
// VENDOR granularity: with it the agent knows e.g. "video is on via model=kling", instead
// of guessing an enum value, calling an unconfigured provider, and burning a round on the
// "not configured" error. Absent (startup define only) → capability-level manifest.
let liveKeys: Record<string, { configured: boolean }> | null = null;
export function applyLiveKeyStatus(keys: Record<string, { configured: boolean }>): void {
  liveKeys = keys;
}

// Non-secret model/routing values from the server (GET /api/keys → models): the
// per-vendor model picks plus PREFERRED_*_VENDOR — the user's default vendor per
// capability ('' = not chosen → agent must ASK in chat before first use).
let liveModels: Record<string, string> | null = null;
export function applyLiveModels(models: Record<string, string>): void {
  liveModels = models;
}

// Which vendors light up a capability: `arg` is the EXACT tool-arg value that selects
// the vendor (and what PREFERRED_*_VENDOR stores); `need` = OR of AND-groups of key
// names (mirrors keystore computeCaps). An empty AND-group marks a keyless local provider.
interface ProviderRow { label: string; arg: string; argKey: 'model' | 'provider'; need: string[][] }
const CAP_PROVIDERS: Partial<Record<CapabilityKey, ProviderRow[]>> = {
  stock: [
    { label: 'Pexels', arg: 'pexels', argKey: 'provider', need: [['PEXELS_API_KEY']] },
    { label: 'Pixabay', arg: 'pixabay', argKey: 'provider', need: [['PIXABAY_API_KEY']] },
    { label: 'Unsplash', arg: 'unsplash', argKey: 'provider', need: [['UNSPLASH_ACCESS_KEY']] },
    { label: 'Freesound', arg: 'freesound', argKey: 'provider', need: [['FREESOUND_API_KEY']] },
  ],
  transcription: [
    { label: 'Local Whisper', arg: 'local', argKey: 'provider', need: [[]] },
  ],
};

const PREFERRED_KEY: Partial<Record<CapabilityKey, string>> = {
  transcription: 'PREFERRED_TRANSCRIPTION_PROVIDER',
};

const rowTag = (r: ProviderRow): string => `${r.label}(${r.argKey}=${r.arg})`;

/** Routing suffix for an ON capability, mode-aware:
 * user default → use it; single vendor → use it;
 * several & manual (every change confirmed) → ask once via ask_followup_questions;
 * several & auto (user delegated) → agent picks and states the reason. */
function providerSuffix(cap: CapabilityKey, mode: ApprovalMode): string {
  const rows = CAP_PROVIDERS[cap];
  if (!rows || !liveKeys) return '';
  const has = (n: string): boolean => Boolean(liveKeys?.[n]?.configured);
  const on = rows.filter((r) => r.need.some((group) => group.every(has)));
  if (on.length === 0) return '';
  const prefKey = PREFERRED_KEY[cap];
  const savedPref = prefKey ? (liveModels?.[prefKey] ?? '').trim() : '';
  const pref = savedPref || (cap === 'transcription' ? 'local' : '');
  const chosen = pref ? on.find((r) => r.arg === pref) : undefined;
  if (chosen) {
    const source = savedPref ? 'user default' : 'default';
    return ` · ${source}: ${rowTag(chosen)} — use it without asking again`;
  }
  if (on.length === 1) return ` · available: ${rowTag(on[0])} — use it directly`;
  const names = on.map(rowTag).join(', ');
  if (!prefKey) return ` · available: ${names}`;
  if (mode === 'auto') return ` · available: ${names} — no user default; auto mode: pick the most suitable one yourself and state the reason`;
  return ` · available: ${names} — no user default: before the first use of this capability in the session, use ask_followup_questions to select one provider, then keep using that choice`;
}

// label + the primary tool + a fallback hint when the capability is off.
const CAP_ROWS: { key: CapabilityKey; label: string; tool: string; fallback: string }[] = [
  { key: 'stock', label: 'Stock-media search', tool: 'search_stock_media', fallback: 'use push_asset to import a known public URL directly' },
  { key: 'transcription', label: 'Transcription/talking-head editing', tool: 'transcribe_track', fallback: 'word-level deletion, filler cleanup, and automatic captions are unavailable' },
  { key: 'sandbox', label: 'Sandbox execution (ffmpeg/node/python)', tool: 'run_code', fallback: 'skip run_code steps; probe_media does not need the sandbox and stays available' },
  { key: 'web', label: 'Web extraction', tool: 'web_browser', fallback: 'ask the user to paste the page content' },
];

/** System-prompt section listing which key-gated tools are on/off (local editing —
 * templates/effects/transitions/zoom/etc. — never needs a key and is always on).
 * `mode` is the current proposal confirmation mode: 'manual' (default) asks the
 * user once when several providers are configured; 'auto' lets the agent choose. */
export function capabilitiesPrompt(
  caps: Record<CapabilityKey, boolean> = currentCaps(),
  mode: ApprovalMode = 'manual',
): string {
  const on: string[] = [];
  const off: string[] = [];
  for (const r of CAP_ROWS) {
    if (caps[r.key]) on.push(`${r.label}(${r.tool}${providerSuffix(r.key, mode)})`);
    else off.push(`${r.label} (${r.tool}) — ${r.fallback}`);
  }
  return `\n\n# Available capabilities (based on configured API keys; local editing is always available without keys)\n`
    + `✅ Configured: ${on.length ? on.join(', ') : '(no key-gated capabilities)'}.\n`
    + '\n'
    + `⬜ Not configured — do not promise these in a plan or call them; they return "not configured" and waste a turn:\n`
    + (off.length ? off.map((s) => `  - ${s}`).join('\n') : '  (none)')
    + '\nWhen an unavailable capability is needed, follow its fallback above or tell the user that the capability is not configured'
    + ' (guide them to Settings → the matching capability page to add a provider).'
    + '\nProvider choice: skill files only document per-provider usage details; the actual provider is decided by THIS list'
    + ' and its routing suffix (user default → single provider → ask once in manual mode → pick freely in auto mode).'
    + ' Never use a provider that is not in the list above.';
}
