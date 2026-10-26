// keystore.verify.ts — .env merge (update / preserve / append / clear) and the
// booleans-only status contract of the settings keystore.
//   npx tsx server/keystore.verify.ts
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { loadEnv } from 'vite';
import { KEY_NAMES, NON_SECRET_NAMES, mergeEnvText, planLegacyLlmMigration, seedKeystore, keyStatus, getKey, setKeys } from './keystore.ts';
import { LLM_PROVIDER_PRESETS, llmProviderConfigNames } from '../shared/llm-providers.ts';
import { MODEL_CAPABILITY_OVERRIDES_KEY, parseModelCapabilityOverrides } from '../shared/model-capabilities.ts';
import { parseEnvText } from '../desktop/env-file.ts';

const isolatedSeed = Object.fromEntries(KEY_NAMES.map((name) => [name, '']));

// ── Legacy unit group migration: only migrate if the current provider has no proprietary configuration; if there is any proprietary value, skip it altogether ──
{
  const mk = (entries: Record<string, string>) => {
    const m = new Map(Object.entries(entries));
    return planLegacyLlmMigration((n) => m.has(n), (n) => m.get(n) ?? '');
  };
  const legacy = mk({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_BASE_URL: 'https://relay.example', LLM_BASE_URL_FORMAT: 'ai-sdk-prefix' });
  assert.deepEqual(legacy, [
    ['LLM_ANTHROPIC_API_KEY', 'k'],
    ['LLM_ANTHROPIC_BASE_URL', 'https://relay.example'],
  ], '纯遗留元组迁给当前厂商');
  // The mine that has been stepped on on site: The user has been assigned a provider-specific key, and then moving to legacy base will quietly redirect the request to the old transit
  assert.deepEqual(mk({
    LLM_PROVIDER: 'anthropic', LLM_ANTHROPIC_API_KEY: 'own-key',
    LLM_API_KEY: 'k', LLM_BASE_URL: 'https://relay.example', LLM_BASE_URL_FORMAT: 'ai-sdk-prefix',
  }), [], '厂商已有专属配置 → 迁移整体跳过(base 落预设)');
  assert.deepEqual(mk({ LLM_PROVIDER: 'anthropic' }), [], '无遗留值 → 空计划');
}

// ── mergeEnvText: update in place, preserve comment/blank/unrelated, append new ──
const out1 = mergeEnvText('# c\nLLM_API_KEY=old\n\nOTHER=keep\n', new Map([['LLM_API_KEY', 'new'], ['PEXELS_API_KEY', 'px']]));
assert.ok(out1.includes('LLM_API_KEY=new') && !out1.includes('LLM_API_KEY=old'), 'updates in place');
assert.ok(out1.includes('# c') && out1.includes('OTHER=keep'), 'preserves comment + unrelated var');
assert.ok(out1.split('\n').includes(''), 'preserves blank line');
assert.ok(out1.includes('PEXELS_API_KEY=px'), 'appends a genuinely-new key');

// ── mergeEnvText: empty value clears that line, others untouched; single trailing newline ──
const out2 = mergeEnvText('LLM_API_KEY=x\nE2B_API_KEY=y\n', new Map([['E2B_API_KEY', '']]));
assert.ok(!out2.includes('E2B_API_KEY') && out2.includes('LLM_API_KEY=x'), 'clears on empty value, keeps others');
assert.ok(out2.endsWith('\n') && !out2.endsWith('\n\n'), 'exactly one trailing newline');

// ── service BASE_URLs are whitelisted and writable via the merge path ──
const BASE_URL_NAMES = ['LLM_ANTHROPIC_BASE_URL', 'UPLOAD_POST_BASE_URL'] as const;
for (const name of BASE_URL_NAMES) {
  assert.ok((KEY_NAMES as readonly string[]).includes(name), `${name} is whitelisted (settable via POST /api/keys)`);
}
const out3 = mergeEnvText('', new Map(BASE_URL_NAMES.map((n) => [n, `https://relay.example/${n.toLowerCase()}`])));
for (const name of BASE_URL_NAMES) {
  assert.ok(out3.includes(`${name}=https://relay.example/${name.toLowerCase()}`), `${name} written to .env text`);
}

// ── envLine quoting: values dotenv would mangle round-trip without changing bytes ──
const out4 = mergeEnvText('', new Map([
  ['LLM_API_KEY', 'ab#cd'],
  ['E2B_TEMPLATE', '"wrapped"'],
  ['PEXELS_API_KEY', 'plain-key'],
]));
assert.ok(out4.includes("LLM_API_KEY='ab#cd'"), 'value with # gets a safe dotenv delimiter');
assert.ok(out4.includes("E2B_TEMPLATE='\"wrapped\"'"), 'quote-wrapped value keeps its quotes');
assert.ok(out4.includes('PEXELS_API_KEY=plain-key'), 'plain value stays unquoted');
const parsed4 = parseDotenv(out4);
assert.equal(parsed4.LLM_API_KEY, 'ab#cd');
assert.equal(parsed4.E2B_TEMPLATE, '"wrapped"');
const overrideModelId = "vendor/custom:model'v2`#preview$HOME";
const overrideWithPunctuation = JSON.stringify([{
  backend: 'api', provider: 'anthropic', modelId: overrideModelId, supportsTools: true,
}]);
const out5 = mergeEnvText('', new Map([[MODEL_CAPABILITY_OVERRIDES_KEY, overrideWithPunctuation]]));
const desktopValue = parseEnvText(out5)[MODEL_CAPABILITY_OVERRIDES_KEY];
const startupDir = await mkdtemp(join(tmpdir(), 'openchatcut-env-roundtrip-'));
const previousOverride = process.env[MODEL_CAPABILITY_OVERRIDES_KEY];
delete process.env[MODEL_CAPABILITY_OVERRIDES_KEY];
try {
  await writeFile(join(startupDir, '.env.local'), out5, 'utf8');
  const viteValue = loadEnv('capability-test', startupDir, '')[MODEL_CAPABILITY_OVERRIDES_KEY];
  assert.equal(viteValue, desktopValue, 'Vite and Electron startup readers preserve the same env bytes');
  seedKeystore({ ...isolatedSeed, [MODEL_CAPABILITY_OVERRIDES_KEY]: desktopValue });
  assert.equal(getKey(MODEL_CAPABILITY_OVERRIDES_KEY), overrideWithPunctuation,
    'Electron startup path restores capability JSON');
  seedKeystore({ ...isolatedSeed, [MODEL_CAPABILITY_OVERRIDES_KEY]: viteValue });
  assert.equal(getKey(MODEL_CAPABILITY_OVERRIDES_KEY), overrideWithPunctuation,
    'Vite startup path restores capability JSON');
} finally {
  if (previousOverride === undefined) delete process.env[MODEL_CAPABILITY_OVERRIDES_KEY];
  else process.env[MODEL_CAPABILITY_OVERRIDES_KEY] = previousOverride;
  await rm(startupDir, { recursive: true, force: true });
}
assert.deepEqual(parseModelCapabilityOverrides(overrideWithPunctuation), [{
  backend: 'api', provider: 'anthropic', modelId: overrideModelId, supportsTools: true,
}]);

// ── seed + status: booleans + source only, and the derived caps — NEVER a key value ──
seedKeystore({ ...isolatedSeed, LLM_API_KEY: 'secret-abc', PEXELS_API_KEY: 'px-1' } as Record<string, string>);
const st = keyStatus();
assert.equal(st.keys.LLM_API_KEY.configured, true, 'seeded key marked configured');
assert.equal(st.keys.LLM_API_KEY.source, 'env', 'seeded key sourced from env');
assert.equal(st.keys.FIRECRAWL_API_KEY.configured, false, 'unseeded key not configured');
assert.equal(st.keys.FIRECRAWL_API_KEY.source, 'none', 'unseeded key source none');
assert.equal(st.caps.stock, true, 'pexels key → stock capability on');
assert.equal(st.caps.web, false, 'no firecrawl key → web capability off');
const serialized = JSON.stringify(st);
assert.ok(!serialized.includes('secret-abc') && !serialized.includes('px-1'), 'status leaks NO key value to the browser');
assert.equal(getKey('LLM_API_KEY'), 'secret-abc', 'getKey returns the live value server-side');
seedKeystore({ ...isolatedSeed, PREFERRED_TRANSCRIPTION_PROVIDER: 'local' } as Record<string, string>);
assert.equal(keyStatus().caps.transcription, true, 'selected local Whisper keeps keyless transcription available');
seedKeystore({
  ...isolatedSeed,
  [MODEL_CAPABILITY_OVERRIDES_KEY]: '[{"backend":"api","provider":"anthropic","modelId":"x","apiKey":"secret"}]',
} as Record<string, string>);
assert.equal(keyStatus().models[MODEL_CAPABILITY_OVERRIDES_KEY], '', 'invalid startup override is not exposed');

const supportedOverride = { backend: 'api', provider: 'anthropic', modelId: 'custom', contextWindowTokens: 128_000 };
const overridesWithRetiredProvider = JSON.stringify([
  { ...supportedOverride, provider: 'retired-provider' }, supportedOverride,
]);
assert.throws(() => parseModelCapabilityOverrides(overridesWithRetiredProvider), /Invalid model capability provider/,
  'new configuration still rejects unavailable providers');
await assert.rejects(setKeys({ [MODEL_CAPABILITY_OVERRIDES_KEY]: overridesWithRetiredProvider }),
  /Invalid model capability provider/, 'settings writes reject unavailable providers before persistence');
seedKeystore({ ...isolatedSeed, [MODEL_CAPABILITY_OVERRIDES_KEY]: overridesWithRetiredProvider });
assert.deepEqual(JSON.parse(getKey(MODEL_CAPABILITY_OVERRIDES_KEY)), [supportedOverride],
  'loading old settings retains valid overrides when another provider was removed');
// Restore the empty override state for the independent legacy migration checks below.
seedKeystore({ ...isolatedSeed, [MODEL_CAPABILITY_OVERRIDES_KEY]: 'invalid' });

// ── non-secret model/routing/toggle channel: explicit routing names + per-vendor
// Base URL/model name (derived with LLM_PROVIDER_PRESETS), the value is echoed by keyStatus().models —
// The SECRET value still never appears in any response ──
const MODEL_ROUTING_NAMES = [
  'LLM_PROVIDER', 'LLM_MODEL', 'CLAUDE_CODE_MODEL',
  MODEL_CAPABILITY_OVERRIDES_KEY,
  'PREFERRED_TRANSCRIPTION_PROVIDER', 'TRANSCRIPTION_LANGUAGE', 'TRANSCRIPTION_DIARIZATION', 'AUTO_TRANSCRIBE_INGEST', 'UI_SCALE', 'UI_SCALE_BASE', 'UI_LOCALE',
  'LOCAL_ASR_MODEL', // On-device ASR model tier: '' | tiny | base | small | medium
  'R2_ENABLED', // Cloud synchronization switch (''=enable/'0'=disable)
  'R2_PRESIGN', // Browser pre-signed direct transmission (''=enabled/'0'=server-side write-through only)
  'MEDIA_DIR',  // Asset saving directory (''=default public/media/uploads),
  'AGENT_IMPORT_ROOTS', // Agent local-path import whitelist (comma-separated absolute dirs)
  'OPENCHATCUT_SKILLS_DIR', // User skill files directory (''=~/.openchatcut/skills)
  'PROXY_URL', // Outbound network proxy (''=use HTTPS_PROXY/HTTP_PROXY env)
] as const;
for (const name of MODEL_ROUTING_NAMES) {
  assert.ok((KEY_NAMES as readonly string[]).includes(name), `${name} is whitelisted (settable via POST /api/keys)`);
  assert.ok(NON_SECRET_NAMES.has(name), `${name} is marked non-secret`);
}
const EXPECTED_NON_SECRET = new Set<string>([
  ...MODEL_ROUTING_NAMES,
  ...LLM_PROVIDER_PRESETS.flatMap((preset) => {
    const names = llmProviderConfigNames(preset.id);
    assert.ok((KEY_NAMES as readonly string[]).includes(names.apiKey), `${names.apiKey} is whitelisted`);
    assert.ok((KEY_NAMES as readonly string[]).includes(names.baseUrl), `${names.baseUrl} is whitelisted`);
    assert.ok((KEY_NAMES as readonly string[]).includes(names.model), `${names.model} is whitelisted`);
    assert.ok(!(KEY_NAMES as readonly string[]).includes(names.legacyContextWindow), 'legacy context key is not settable');
    return [names.baseUrl, names.model];
  }),
]);
assert.deepStrictEqual(
  new Set(NON_SECRET_NAMES), EXPECTED_NON_SECRET,
  'NON_SECRET_NAMES = explicit routing/config names plus per-vendor Base URL/model only',
);

// seed one SECRET + one non-secret on top of the state above (seeds accumulate in-process)
seedKeystore({ ...isolatedSeed, LLM_API_KEY: 'sec-x', LLM_ANTHROPIC_MODEL: 'claude-sonnet-5-5' } as Record<string, string>);
const st2 = keyStatus();
assert.equal(st2.models['LLM_ANTHROPIC_MODEL'], 'claude-sonnet-5-5', 'non-secret model value echoed in models');
assert.equal(st2.models['CLAUDE_CODE_MODEL'], '', 'unset non-secret name echoes empty string');
assert.ok(!('LLM_API_KEY' in st2.models), 'SECRET key has no field in models at all');
assert.equal(st2.keys.LLM_API_KEY.configured, true, 'SECRET key still reported as configured boolean');
assert.ok(!JSON.stringify(st2).includes('sec-x'), 'SECRET value appears NOWHERE in the serialized status');

seedKeystore({
  ...isolatedSeed,
  LLM_ANTHROPIC_MODEL: 'custom/migrated',
  LLM_ANTHROPIC_CONTEXT_WINDOW: '65536',
} as Record<string, string>);
const migrated = parseModelCapabilityOverrides(keyStatus().models[MODEL_CAPABILITY_OVERRIDES_KEY]);
assert.deepEqual(migrated.find((record) => record.modelId === 'custom/migrated')?.contextWindowTokens, 65_536,
  'legacy provider context migrates to the exact selected model identity');

console.log('keystore.verify: ok');
