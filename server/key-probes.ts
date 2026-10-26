// Set the server detection table of the "Test Connection" panel: the lightest real authentication request for each provider page
// (read-only endpoint or near-zero cost call), verify that the Key + Base URL is available. The key comes from keystore,
// Or the request body overrides (the temporary value that has not been saved in the panel will only take effect for this detection and will not be saved).
// Security invariant: The result only contains ok / message / status / latencyMs, and never echoes any key value;
// The provider's error copy is flattened and truncated before entering the message. Align the endpoints and authentication headers of each provider call one by one
import { proxyDispatcher } from './outbound-proxy.ts';
import { getKey, KEY_NAMES, type KeyName } from './keystore.ts';
import { r2Probe } from './r2.ts';
import { mediaDirProbe, mediaDirPostCheck, mediaDirOkText } from './media-dir.ts';
import {
  AI_SDK_BASE_URL_FORMAT,
  resolveLlmBaseUrl,
} from './llm-config.ts';
import {
  LLM_PROVIDER_PRESETS,
  llmProviderConfigNames,
  type LlmProvider,
} from '../shared/llm-providers.ts';
import {
  classifyStatus,
  networkMessage,
  parseModelCatalog,
  sanitizeProbeText,
  type ProbeResult,
} from './key-probe-result.ts';
import { PROBE_TIMEOUT_MS, runDataDirProbe, runProxyProbe } from './key-probe-local.ts';
export { classifyStatus, networkMessage, parseModelCatalog, type ProbeResult } from './key-probe-result.ts';
export { runDataDirProbe, runProxyProbe } from './key-probe-local.ts';
// Proxy-aware fetch: attaches the configured outbound proxy (keystore
// PROXY_URL or HTTPS_PROXY/HTTP_PROXY env) via undici dispatcher.
type FetchInit = Parameters<typeof fetch>[1] & { dispatcher?: unknown };

// Probes send REAL stored credentials to a user/agent-settable base URL.
// Loopback and private hosts stay allowed (local models and LAN gateways are
// legitimate), but cloud metadata / link-local targets and credential-bearing
// or non-http(s) URLs never are — those only appear in SSRF exfil attempts.
export function probeUrlError(url: RequestInfo | URL): string | null {
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    return '探测地址不是合法 URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `探测地址协议不支持:${parsed.protocol}`;
  }
  if (parsed.username || parsed.password) return '探测地址不允许携带内嵌凭据';
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) || host.startsWith('fe80:')
    || host === 'metadata.google.internal') {
    return '探测地址指向云元数据/链路本地网段,已拒绝';
  }
  return null;
}

const fetchWithProxy = (url: RequestInfo | URL, init?: FetchInit): Promise<Response> => {
  const unsafe = probeUrlError(url);
  if (unsafe) return Promise.reject(new Error(unsafe));
  return fetch(url, { ...init, dispatcher: proxyDispatcher() } as RequestInit);
};


type Get = (name: KeyName) => string;

interface ProbeDef {
  /** Starting test threshold: OR of AND-groups (every name in one inner list must be present) */
  readonly needs: readonly (readonly KeyName[])[];
  readonly run: (get: Get) => Promise<Response>;
  /** 2xx may also be a provider-level failure (MiniMax base_resp); return error text, null = true success */
  readonly postCheck?: (bodyText: string) => string | null;
  /** Custom conclusion when successful (non-network check such as local disk probe); null/default = general "connection successful" */
  readonly okText?: (bodyText: string) => string | null;
  /** Parse a successful model-catalog response. Only LLM provider pages use this. */
  readonly models?: (bodyText: string) => string[];
}

const t = (): AbortSignal => AbortSignal.timeout(PROBE_TIMEOUT_MS);
const base = (get: Get, name: KeyName, def: string): string => (get(name) || def).replace(/\/+$/, '');
const bearer = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}` });
function llmProbe(provider: LlmProvider): ProbeDef {
  const names = llmProviderConfigNames(provider);
  const apiKeyName = names.apiKey as KeyName;
  const baseUrlName = names.baseUrl as KeyName;
  return {
    needs: [[apiKeyName]],
    run: (get) => {
      const headers = { 'x-api-key': get(apiKeyName), 'anthropic-version': '2023-06-01' };
      const root = resolveLlmBaseUrl(provider, get(baseUrlName), AI_SDK_BASE_URL_FORMAT);
      return fetchWithProxy(`${root}/models`, { signal: t(), headers });
    },
    models: parseModelCatalog,
  };
}

/** The provider's error copy is flattened before entering the results: line breaks and truncation are removed. Never splice any key values.*/
export function sanitize(text: string): string {
  return sanitizeProbeText(text);
}

export const PROBES: Record<string, ProbeDef> = {
  ...Object.fromEntries(LLM_PROVIDER_PRESETS.map((preset) => [
    `llm/${preset.id}`,
    llmProbe(preset.id),
  ])),
  // /v1/search has been opened to anonymous users (the measured number is 200 without key), and the key; collections cannot be detected
  // It is the account binding endpoint, and the fake key is stable 401.
  'stock/pexels': {
    needs: [['PEXELS_API_KEY']],
    run: (get) => fetch('https://api.pexels.com/v1/collections?per_page=1', {
      signal: t(), headers: { Authorization: get('PEXELS_API_KEY') },
    }),
  },
  // Pixabay official design: key takes the query parameter (the server is directly connected to HTTPS, the same shape as the stock plugin).
  'stock/pixabay': {
    needs: [['PIXABAY_API_KEY']],
    run: (get) => {
      const params = new URLSearchParams({ key: get('PIXABAY_API_KEY'), q: 'sky', per_page: '3' });
      return fetchWithProxy(`https://pixabay.com/api/?${params.toString()}`, { signal: t() });
    },
  },
  // Unsplash: The search endpoint requires Client-ID, fake key 401.
  'stock/unsplash': {
    needs: [['UNSPLASH_ACCESS_KEY']],
    run: (get) => fetch('https://api.unsplash.com/search/photos?query=sky&per_page=1', {
      signal: t(), headers: { Authorization: 'Client-ID ' + get('UNSPLASH_ACCESS_KEY') },
    }),
  },
  // Freesound: token uses query (same shape as stock plugin), false token 401.
  'stock/freesound': {
    needs: [['FREESOUND_API_KEY']],
    run: (get) => {
      const params = new URLSearchParams({ query: 'wind', page_size: '1', fields: 'id', token: get('FREESOUND_API_KEY') });
      return fetchWithProxy('https://freesound.org/apiv2/search/text/?' + params.toString(), { signal: t() });
    },
  },
  'sandbox/e2b': {
    needs: [['E2B_API_KEY']],
    run: (get) => fetch('https://api.e2b.dev/sandboxes', {
      signal: t(), headers: { 'X-API-KEY': get('E2B_API_KEY') },
    }),
  },
  'web/firecrawl': {
    needs: [['FIRECRAWL_API_KEY']],
    run: (get) => fetch('https://api.firecrawl.dev/v2/team/credit-usage', {
      signal: t(), headers: bearer(get('FIRECRAWL_API_KEY')),
    }),
  },
  // Read-only account endpoint; a fake key is a stable 401. Upload-Post keys
  // use the `Apikey` scheme, not `Bearer`.
  'publish/upload-post': {
    needs: [['UPLOAD_POST_API_KEY']],
    run: (get) => fetch(`${base(get, 'UPLOAD_POST_BASE_URL', 'https://api.upload-post.com')}/api/uploadposts/me`, {
      signal: t(), headers: { Authorization: `Apikey ${get('UPLOAD_POST_API_KEY')}` },
    }),
  },
  // S3 HeadBucket is sent via SDK (SigV4 signature cannot be fetched manually), r2.ts synthesizes Response:
  // 200=The bucket exists and has been authenticated; 403/404 goes to classifyStatus; the network layer throws it to networkMessage as it is.
  'storage/r2': {
    needs: [['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']],
    run: (get) => r2Probe(get),
  },
  // Local saving directory: disk check (create directory + write and delete detection files), non-network request. Empty group needs = not filled in
  // It can also be tested (if not set = use the default directory, it is legal).
  'storage/local': {
    needs: [[]],
    run: (get) => mediaDirProbe(get),
    postCheck: mediaDirPostCheck,
    okText: mediaDirOkText,
  },
};

/** Temporarily stored overrides (in the whitelist, the empty string represents clearing for this test) overwrite the stored value.*/
export function makeGetter(overrides: Record<string, unknown>): Get {
  const clean = new Map<string, string>();
  for (const [name, raw] of Object.entries(overrides)) {
    if (!(KEY_NAMES as readonly string[]).includes(name)) continue; // Discarded outside the whitelist
    clean.set(name, String(raw ?? '').trim());
  }
  if (clean.has('LLM_BASE_URL') && !clean.has('LLM_BASE_URL_FORMAT')) {
    clean.set('LLM_BASE_URL_FORMAT', clean.get('LLM_BASE_URL') ? AI_SDK_BASE_URL_FORMAT : '');
  }
  return (name) => clean.has(name) ? clean.get(name)! : getKey(name);
}

/** Run a connectivity probe of the provider's page. Unconfigured/unknown pages are returned before sending a request and do not hit the network.*/
export async function runProbe(page: string, overrides: Record<string, unknown>): Promise<ProbeResult> {
  if (page === 'agent/proxy') return runProxyProbe(overrides);
  // The storage root is not a keystore key (makeGetter would drop it), so its
  // writability check reads the panel's raw value directly.
  if (page === 'storage/projects') return runDataDirProbe(overrides);
  const probe = PROBES[page];
  if (!probe) return { ok: false, message: '该厂商暂不支持连接测试' };
  const get = makeGetter(overrides);
  const ready = probe.needs.some((group) => group.every((n) => get(n).length > 0));
  if (!ready) return { ok: false, message: '尚未填写 API Key · 填好后再点测试' };
  const started = Date.now();
  try {
    const response = await probe.run(get);
    const latencyMs = Date.now() - started;
    const bodyText = await response.text().catch(() => '');
    if (response.ok) {
      const vendorError = probe.postCheck?.(bodyText) ?? null;
      if (vendorError) return { ok: false, status: response.status, latencyMs, message: vendorError };
      const models = probe.models?.(bodyText);
      const modelText = models
        ? models.length > 0 ? ` · 已读取 ${models.length} 个模型` : ' · 接口未返回模型列表'
        : '';
      const okText = probe.okText?.(bodyText) ?? '连接成功 · 鉴权通过';
      return {
        ok: true,
        status: response.status,
        latencyMs,
        message: `${okText}${modelText} · ${latencyMs}ms`,
        ...(models ? { models } : {}),
      };
    }
    return { ...classifyStatus(response.status, bodyText), latencyMs };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, message: networkMessage(error) };
  }
}
