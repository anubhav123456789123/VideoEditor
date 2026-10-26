import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createMiniConnect } from '../desktop/mini-connect.ts';
import {
  expandLlmProviderPatch,
  llmOperationPath,
  resolveLlmBaseUrl,
} from './llm-config.ts';
import { proxyMiddleware } from './proxy.ts';
import { llmProxyPlugin, llmProviderForRequest } from './plugins/llm-proxy.ts';
import { LLM_PROVIDER_PRESETS, normalizeLlmProvider } from '../shared/llm-providers.ts';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

assert.equal(resolveLlmBaseUrl('anthropic', ''), 'https://api.anthropic.com/v1');
assert.equal(resolveLlmBaseUrl('anthropic', 'https://relay.test/api', ''), 'https://relay.test/api/v1');
assert.equal(llmOperationPath('anthropic'), '/messages');

// ── llmHeaders: Claude upstream authentication (x-api-key + anthropic-version) ──
{
  const { KEY_NAMES, seedKeystore } = await import('./keystore.ts');
  const { llmErrorMessage, llmHeaders } = await import('./plugins/llm-proxy.ts');
  seedKeystore({
    ...Object.fromEntries(KEY_NAMES.map((name) => [name, ''])),
    LLM_PROVIDER: 'anthropic',
    LLM_API_KEY: 'ak-1',
  } as Record<string, string>);
  const reqFor = (provider: string) => ({ headers: { 'x-openchatcut-provider': provider } } as never);
  assert.throws(() => llmProviderForRequest(reqFor('retired-provider')), /Unsupported LLM provider/);
  for (const preset of LLM_PROVIDER_PRESETS) {
    assert.equal(llmProviderForRequest(reqFor(` ${preset.id.toUpperCase()} `)), preset.id);
  }
  assert.equal(llmProviderForRequest(), 'anthropic');
  assert.equal(llmProviderForRequest(reqFor('')), 'anthropic');
  assert.equal(normalizeLlmProvider('retired-provider'), 'anthropic', 'settings fallback stays compatible');
  assert.deepEqual(llmHeaders(reqFor('anthropic')), { 'x-api-key': 'ak-1', 'anthropic-version': '2023-06-01' }, 'anthropic x-api-key(经遗留迁移)');
  assert.match(llmErrorMessage(401, reqFor('anthropic')), /Claude.*设置.*API Key/, '认证错误给设置入口');
  assert.match(llmErrorMessage(429, reqFor('anthropic')), /额度不足.*稍后重试/, '限流错误给额度提示');
}

// A single provider: switching to the same provider keeps the saved model and URL.
const unchanged = expandLlmProviderPatch(new Map([['LLM_PROVIDER', 'anthropic']]), 'anthropic');
assert.deepEqual(Object.fromEntries(unchanged), { LLM_PROVIDER: 'anthropic' });

const seen: Array<{ url: string; authorization?: string; provider?: string; body: string; cookie?: string }> = [];
const upstream = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  seen.push({
    url: req.url ?? '',
    authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    provider: typeof req.headers['x-openchatcut-provider'] === 'string'
      ? req.headers['x-openchatcut-provider']
      : undefined,
    cookie: typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
    body: Buffer.concat(chunks).toString('utf8'),
  });
  if (req.url?.includes('/unauthorized')) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"error":{"type":"vendor_auth_error","secret_debug":"raw body must stay hidden"}}');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('{"ok":true}');
});
const upstreamPort = await listen(upstream);

let target = `http://127.0.0.1:${upstreamPort}/v1beta/openai?api-version=preview`;
const app = createMiniConnect((error) => { throw error; });
app.use('/llm', proxyMiddleware({
  target: () => target,
  headers: () => ({ authorization: 'Bearer server-secret' }),
  forceJsonContentType: true,
  errorMessage: (status) => `Friendly provider error (${status}). Check Agent settings.`,
}));
const proxy = createServer(app.handle);
const proxyPort = await listen(proxy);
const providerApp = createMiniConnect((error) => { throw error; });
const configureProvider = llmProxyPlugin().configureServer;
assert.equal(typeof configureProvider, 'function');
if (typeof configureProvider === 'function') {
  await configureProvider.call({} as never, { middlewares: providerApp } as never);
}
const providerProxy = createServer(providerApp.handle);
const providerProxyPort = await listen(providerProxy);

try {
  const { seedKeystore } = await import('./keystore.ts');
  seedKeystore({ LLM_ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1` });
  const unsupported = await fetch(`http://127.0.0.1:${providerProxyPort}/llm/messages`, {
    method: 'POST',
    headers: { 'x-openchatcut-provider': 'retired-provider' },
    body: '{}',
  });
  assert.equal(unsupported.status, 400);
  assert.deepEqual(await unsupported.json(), { error: { message: 'Unsupported LLM provider' } });
  assert.equal(seen.length, 0, 'unsupported provider must not reach the configured fallback upstream');
  const first = await fetch(`http://127.0.0.1:${proxyPort}/llm/chat/completions?stream=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openchatcut-provider': 'anthropic' },
    body: '{"model":"compatible"}',
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'application/json');
  assert.deepEqual(await first.json(), { ok: true });

  target = `http://127.0.0.1:${upstreamPort}/v1`;
  await fetch(`http://127.0.0.1:${proxyPort}/llm/responses`, {
    method: 'POST',
    body: '{"model":"openai"}',
  });

  // Browser cookies (shared across every localhost port) must never reach upstream.
  await fetch(`http://127.0.0.1:${proxyPort}/llm/responses`, {
    method: 'POST',
    headers: { 'x-openchatcut-provider': 'anthropic', cookie: 'session=must-not-leak' },
    body: '{"model":"openai"}',
  });

  assert.deepEqual(seen, [
    {
      url: '/v1beta/openai/chat/completions?api-version=preview&stream=true',
      authorization: 'Bearer server-secret',
      provider: undefined,
      cookie: undefined,
      body: '{"model":"compatible"}',
    },
    {
      url: '/v1/responses',
      authorization: 'Bearer server-secret',
      provider: undefined,
      cookie: undefined,
      body: '{"model":"openai"}',
    },
    {
      url: '/v1/responses',
      authorization: 'Bearer server-secret',
      provider: undefined,
      cookie: undefined,
      body: '{"model":"openai"}',
    },
  ]);

  const denied = await fetch(`http://127.0.0.1:${proxyPort}/llm/unauthorized`);
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), {
    error: { message: 'Friendly provider error (401). Check Agent settings.' },
  }, 'raw provider JSON is replaced with one actionable message');
} finally {
  await close(providerProxy);
  await close(proxy);
  await close(upstream);
}

console.log('llm proxy checks passed');
