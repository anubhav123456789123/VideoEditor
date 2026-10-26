// checks:key-probes pure logic - detection table coverage, override whitelist, status classification,
// runProbe does not hit the network early exit. There are no real network requests in the whole process.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LLM_PROVIDER_PRESETS } from '../shared/llm-providers.ts';

// Directory probes answer from the runtime profile, which resolves once at module load
// out of HOME and the profile environment. Pin both to a throwaway home before importing
// the module under test: otherwise a developer's own storage root, or an exported dev
// profile id, decides the outcome of the directory assertions below.
const fixtureHome = mkdtempSync(join(tmpdir(), 'openchatcut-key-probes-'));
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;
delete process.env.OPENCHATCUT_DEV_PROFILE_ID;
delete process.env.OPENCHATCUT_DATA_DIR;
process.on('exit', () => rmSync(fixtureHome, { recursive: true, force: true }));

const {
  PROBES, classifyStatus, makeGetter, networkMessage, runProbe, runProxyProbe,
} = await import('./key-probes.ts');

// 1. One-to-one correspondence with the provider page of settingsSchema (the page key has the same name); the llm page is derived from the preset,
// Synchronize this list when adding other capability pages.
const EXPECTED_PAGES = [
  ...LLM_PROVIDER_PRESETS.map((preset) => `llm/${preset.id}`),
  'stock/pexels', 'stock/pixabay', 'stock/unsplash', 'stock/freesound',
  'sandbox/e2b',
  'web/firecrawl',
  'publish/upload-post',
  'storage/r2', 'storage/local',
];
for (const page of EXPECTED_PAGES) assert.ok(PROBES[page], `probe missing for ${page}`);
assert.equal(Object.keys(PROBES).length, EXPECTED_PAGES.length, 'PROBES 有清单外的多余页');

// 2. Override whitelist: items outside the whitelist will be discarded, empty values ​​will not be covered, and values ​​will be trimmed.
{
  const get = makeGetter({ PEXELS_API_KEY: '  k1  ', NOT_A_KEY: 'x', LLM_ANTHROPIC_API_KEY: '   ' });
  assert.equal(get('PEXELS_API_KEY'), 'k1');
  assert.equal(get('LLM_ANTHROPIC_API_KEY'), '');   // Blank override does not take effect; keystore is not seeded and has no value
  assert.equal(get('PIXABAY_API_KEY'), '');
}

// 3. Status classification: Authentication / Address / Current Limiting / Others, each has a clear conclusion.
assert.equal(classifyStatus(401, '').ok, false);
assert.match(classifyStatus(401, '').message, /鉴权失败/);
assert.match(classifyStatus(403, '').message, /鉴权失败/);
assert.match(classifyStatus(404, '').message, /Base URL/);
assert.equal(classifyStatus(429, '').ok, true);
assert.match(classifyStatus(429, '').message, /限流/);
{
  const r = classifyStatus(500, 'boom\n  line2\ttail');
  assert.equal(r.ok, false);
  assert.match(r.message, /HTTP 500 · boom line2 tail/); // flatten whitespace
  assert.ok(classifyStatus(500, 'x'.repeat(500)).message.length < 200, '厂商长报错要截断');
}

// 5. Network layer failure copy: clearly "does not mean Key error", and timeout is worded separately.
assert.match(networkMessage(new TypeError('fetch failed')), /网络不可达[\s\S]*不代表 Key 错误/);
assert.match(networkMessage(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })), /超时/);

// 6. runProbe exits early: Unknown page / Key is not configured and does not connect to the network (keystore is empty, synchronization will return).
{
  const unknown = await runProbe('nope/vendor', {});
  assert.equal(unknown.ok, false);
  assert.match(unknown.message, /暂不支持/);
  const unconfigured = await runProbe('stock/pexels', {});
  assert.equal(unconfigured.ok, false);
  assert.match(unconfigured.message, /尚未填写 API Key/);
  // Blank overrides stay unconfigured
  const blank = await runProbe('llm/anthropic', { LLM_ANTHROPIC_API_KEY: ' ' });
  assert.match(blank.message, /尚未填写 API Key/);
}

// 7. Proxy page uses its own connectivity semantics rather than provider/API-key language.
{
  const missing = await runProxyProbe({ PROXY_URL: '' });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /尚未填写代理地址/);
  const malformed = await runProxyProbe({ PROXY_URL: 'not a proxy url' });
  assert.equal(malformed.ok, false);
  assert.match(malformed.message, /代理地址格式无效/);
}

// 7b. The Claude probe lists models from {base}/models with the Anthropic headers.
{
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; key: string | null; version: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), key: headers.get('x-api-key'), version: headers.get('anthropic-version') });
    return Response.json({ data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }] });
  };
  try {
    const ok = await runProbe('llm/anthropic', { LLM_ANTHROPIC_API_KEY: 'sk-ant-test' });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.models, ['claude-opus-5-5', 'claude-sonnet-5-5']);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.anthropic\.com\/v1\/models/);
    assert.equal(calls[0].key, 'sk-ant-test');
    assert.equal(calls[0].version, '2023-06-01');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// 8. Local storage directory probe: empty group needs = can be tested if not filled in (not set = default directory); the relative path is configured
// Level failure (postCheck copy, no HTTP prefix); success copy goes to okText. Neither case touched the plate.
{
  const unset = await runProbe('storage/local', {});
  assert.equal(unset.ok, true);
  assert.match(unset.message, /默认目录 .*public[/\\]media[/\\]uploads/); // The copy has a machine-related absolute path and only anchors the tail section.
  const relative = await runProbe('storage/local', { MEDIA_DIR: 'relative/path' });
  assert.equal(relative.ok, false);
  assert.match(relative.message, /绝对路径/);
  assert.doesNotMatch(relative.message, /HTTP/);
}

// 9. Project storage root probe: a local disk check, never a network request. Empty = the
// default root (legal), relative path rejected, writable folder accepted, and a root
// pinned by the environment refuses the change instead of pretending to accept it.
{
  const unset = await runProbe('storage/projects', { OPENCHATCUT_DATA_DIR: '' });
  assert.equal(unset.ok, true);
  assert.match(unset.message, /默认目录 .*\.openchatcut/); // machine-dependent absolute path, anchor the tail only

  const relative = await runProbe('storage/projects', { OPENCHATCUT_DATA_DIR: 'relative/saves' });
  assert.equal(relative.ok, false);
  assert.match(relative.message, /绝对路径/);
  assert.doesNotMatch(relative.message, /HTTP/);

  const target = join(fixtureHome, 'Saves');
  const writable = await runProbe('storage/projects', { OPENCHATCUT_DATA_DIR: target });
  assert.equal(writable.ok, true);
  assert.match(writable.message, /目录可写/);

  // Without the field in the payload, the probe tests the root already recorded by the
  // settings UI, so "test connection" answers for the storage actually in use.
  mkdirSync(join(fixtureHome, '.openchatcut'), { recursive: true });
  writeFileSync(
    join(fixtureHome, '.openchatcut', 'data-dir.json'),
    JSON.stringify({ version: 1, dataDir: target }),
  );
  const recorded = await runProbe('storage/projects', {});
  assert.equal(recorded.ok, true);
  // A Windows path interpolated into a RegExp loses separators to escape
  // sequences ("\T", "\S"), so match the recorded path literally.
  assert.ok(
    recorded.message.includes(`目录可写 · ${target}`),
    `expected the recorded root to be reported, got: ${recorded.message}`,
  );

  process.env.OPENCHATCUT_DATA_DIR = target;
  try {
    const pinned = await runProbe('storage/projects', { OPENCHATCUT_DATA_DIR: join(fixtureHome, 'Elsewhere') });
    assert.equal(pinned.ok, false);
    assert.match(pinned.message, /固定/);
  } finally {
    delete process.env.OPENCHATCUT_DATA_DIR;
  }
}

console.log('key-probes.verify OK');
