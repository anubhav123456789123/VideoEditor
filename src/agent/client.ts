import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { SharedV4ProviderOptions } from '@ai-sdk/provider';
import { resolveModelRequestPolicy } from '../../shared/llm-providers';
import { MODEL, PROVIDER } from './providerConfig';
import type { LlmProvider } from './providerConfig';
import { normalizeLlmMessages, withoutModelImages } from './messages';
import { getActiveAgentModelChoice, getAgentModelSnapshot, type AgentModelChoice } from './model-selection';
import { effectiveOutputTokenBudget } from './context-compaction';
import type { AgentCacheMode } from './settings/agentSettings';

export {
  MODEL,
  PROVIDER,
  DEFAULT_LLM_PROVIDER,
  defaultModelForProvider,
  normalizeLlmProvider,
  protocolForProvider,
  providerApiPath,
  setLlmConfig,
  setLlmModel,
  setLlmProvider,
} from './providerConfig';
export type { LlmProvider } from './providerConfig';
export type ConfiguredLanguageModel = Exclude<LanguageModel, string>;

const ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
// The server proxy (/llm) owns the Anthropic base URL and injects the API key;
// the browser never sees it. The AI SDK appends the Messages API path.
const PROXY_API_BASE = `${ORIGIN}/llm`;
const PROXY_KEY = 'proxy-injects-the-real-key';

type ModelFactory = (model: string) => ConfiguredLanguageModel;
let anthropicFactory: Promise<ModelFactory> | null = null;

function claudeFactory(provider: LlmProvider): Promise<ModelFactory> {
  anthropicFactory ??= import('@ai-sdk/anthropic')
    .then(({ createAnthropic }) => createAnthropic({
      baseURL: PROXY_API_BASE,
      apiKey: PROXY_KEY,
      headers: { 'x-openchatcut-provider': provider },
    }))
    .catch((error: unknown) => {
      anthropicFactory = null;
      throw error;
    });
  return anthropicFactory;
}

export async function getLanguageModel(
  provider: LlmProvider = PROVIDER,
  model: string = MODEL,
): Promise<ConfiguredLanguageModel> {
  return (await claudeFactory(provider))(model);
}

export function getLanguageModelProviderOptions(
  provider: LlmProvider = PROVIDER,
  cacheMode: AgentCacheMode = 'short',
): SharedV4ProviderOptions | undefined {
  return resolveModelRequestPolicy(provider, cacheMode).providerOptions;
}
export function cacheTtlMsForProvider(
  provider: LlmProvider,
  cacheMode: AgentCacheMode,
): number | undefined {
  return resolveModelRequestPolicy(provider, cacheMode).cacheTtlMs;
}


function generationChoice(): AgentModelChoice | undefined {
  const active = getActiveAgentModelChoice();
  if (active?.backend === 'api') return active;
  return getAgentModelSnapshot().choices.find((choice) => (
    choice.backend === 'api' && choice.provider === PROVIDER && choice.model === MODEL
  ));
}

// A fixed 60s total budget silently capped what these calls could produce:
// MG/shader generation asks for up to 64k output tokens, and most providers
// stream well under 100 tok/s, so large generations failed as "timeout" no
// matter how healthy the connection was. Scale the ceiling with the requested
// budget instead, keeping 60s as the floor for small asks.
const GENERATION_TIMEOUT_FLOOR_MS = 60_000;
const GENERATION_TIMEOUT_MAX_MS = 600_000;
const GENERATION_TOKENS_PER_SECOND = 40;

export function generationTimeoutMs(maxOutputTokens: number): number {
  if (!Number.isFinite(maxOutputTokens) || maxOutputTokens <= 0) return GENERATION_TIMEOUT_FLOOR_MS;
  const streamingMs = (maxOutputTokens / GENERATION_TOKENS_PER_SECOND) * 1000;
  return Math.min(GENERATION_TIMEOUT_MAX_MS, Math.max(GENERATION_TIMEOUT_FLOOR_MS, Math.round(streamingMs)));
}

export async function generateAgentText(options: {
  system?: string;
  prompt?: string;
  messages?: readonly unknown[];
  maxOutputTokens: number;
}): Promise<string> {
  const choice = generationChoice();
  const provider = choice?.provider ?? PROVIDER;
  const model = choice?.model ?? MODEL;
  const providerOptions = getLanguageModelProviderOptions(provider);
  const modelOutputLimit = choice
    ? effectiveOutputTokenBudget(
        choice.capabilities.maxOutputTokens.value,
        choice.capabilities.contextWindowTokens.value,
      )
    : options.maxOutputTokens;
  const maxOutputTokens = Math.min(options.maxOutputTokens, modelOutputLimit);
  const base = {
    model: await getLanguageModel(provider, model),
    system: options.system,
    maxOutputTokens,
    timeout: { totalMs: generationTimeoutMs(maxOutputTokens) },
    ...(providerOptions ? { providerOptions } : {}),
  };
  const normalized = options.messages ? normalizeLlmMessages(options.messages) : null;
  const messages = normalized && choice?.capabilities.supportsImages.value === false
    ? withoutModelImages(normalized)
    : normalized;
  const result = messages
    ? await generateText({ ...base, messages })
    : await generateText({ ...base, prompt: options.prompt ?? '' });
  return result.text;
}
