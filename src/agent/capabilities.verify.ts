// capabilities.verify.ts — mode-aware provider routing: on/off partition, fallback
// (no Next define) fallback of the configured-capabilities manifest.
//   npx tsx src/agent/capabilities.verify.ts
import assert from 'node:assert/strict';
import { applyLiveKeyStatus, applyLiveModels, capabilitiesPrompt, CONFIGURED_CAPS, type CapabilityKey } from './capabilities';

const ALL_OFF: Record<CapabilityKey, boolean> = {
  stock: false, transcription: false, sandbox: false, web: false,
};

// ── all-off: every gated tool listed as not configured, none marked available ──
const off = capabilitiesPrompt(ALL_OFF);
assert.ok(off.includes('search_stock_media') && off.includes('transcribe_track') && off.includes('run_code'), 'lists gated tools');
assert.ok(off.includes('(no key-gated capabilities)'), 'no capability marked available when all off');
assert.ok(off.includes('push_asset'), 'includes a fallback hint for an off capability');
assert.ok(!/submit_(image|voice|video|music|sound)/.test(off), 'generation tools are gone from the manifest');

// ── mixed: stock + transcription on → ✅ section; sandbox in the ⬜ section ──
const mixed = capabilitiesPrompt({ ...ALL_OFF, stock: true, transcription: true });
const onIdx = mixed.indexOf('✅');
const offIdx = mixed.indexOf('⬜');
assert.ok(onIdx >= 0 && offIdx > onIdx, 'both sections present, ✅ before ⬜');
const onLine = mixed.slice(onIdx, offIdx);
assert.ok(onLine.includes('search_stock_media') && onLine.includes('transcribe_track'), 'configured caps in ✅ section');
assert.ok(!onLine.includes('run_code'), 'unconfigured cap NOT in ✅ section');
assert.ok(mixed.slice(offIdx).includes('run_code'), 'unconfigured cap in ⬜ section');

// ── vendor granularity + routing semantics ──
// single configured vendor → named with its tool arg and "use it directly"
applyLiveKeyStatus({ PEXELS_API_KEY: { configured: true } });
const single = capabilitiesPrompt({ ...ALL_OFF, stock: true });
assert.ok(single.includes('Pexels(provider=pexels) — use it directly'), 'single vendor → use directly');
assert.ok(!single.includes('Pixabay(provider=pixabay)'), 'unconfigured vendor NOT listed');

// several stock vendors and no routing preference key → listed, never forced to ask
applyLiveKeyStatus({ PEXELS_API_KEY: { configured: true }, PIXABAY_API_KEY: { configured: true } });
const several = capabilitiesPrompt({ ...ALL_OFF, stock: true }, 'manual');
assert.ok(several.includes('Pexels(provider=pexels)') && several.includes('Pixabay(provider=pixabay)'), 'options listed');
assert.ok(!several.includes('ask_followup_questions'), 'stock has no routing default to ask about');

// on-device transcription is keyless and is the default route
applyLiveKeyStatus({});
applyLiveModels({});
const local = capabilitiesPrompt({ ...ALL_OFF, transcription: true });
assert.ok(local.includes('default: Local Whisper(provider=local) — use it without asking again'),
  'local Whisper is the default transcription route');
applyLiveModels({ PREFERRED_TRANSCRIPTION_PROVIDER: 'local' });
assert.ok(capabilitiesPrompt({ ...ALL_OFF, transcription: true })
  .includes('user default: Local Whisper(provider=local)'), 'a saved default is honored');
applyLiveModels({});

// the provider-choice rule names the routing ladder and pins choice to the list
const auto = capabilitiesPrompt({ ...ALL_OFF, stock: true }, 'auto');
assert.ok(auto.includes('user default → single provider → ask once in manual mode → pick freely in auto mode'),
  'provider-choice rule documents the routing ladder');
assert.ok(auto.includes('Never use a provider that is not in the list above'), 'choice pinned to configured list');
assert.ok(auto.includes('guide them to Settings'), 'unconfigured capability points to Settings');

// ── tsx (no Next define): CONFIGURED_CAPS falls back to all-false without throwing ──
assert.equal(typeof CONFIGURED_CAPS.stock, 'boolean', 'CONFIGURED_CAPS resolves under tsx (all-false fallback, no ReferenceError)');
assert.equal(CONFIGURED_CAPS.stock, false, 'fallback is all-false outside the Next bundle');

console.log('capabilities.verify: ok');
