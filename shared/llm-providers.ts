import type { SharedV4ProviderOptions } from '@ai-sdk/provider';

/** Wire protocol the server proxy speaks upstream. Anthropic is the only provider. */
export type LlmProtocol = 'anthropic';

interface LlmProviderPreset {
  readonly id: string;
  readonly label: string;
  readonly protocol: LlmProtocol;
  readonly baseUrl: string;
  readonly defaultModel: string;
}

export const LLM_PROVIDER_PRESETS = [
  {
    id: 'anthropic',
    label: 'Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-opus-5-5',
  },
] as const satisfies readonly LlmProviderPreset[];

export type LlmProvider = (typeof LLM_PROVIDER_PRESETS)[number]['id'];

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'anthropic';

export interface LlmProviderConfigNames {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly legacyContextWindow: string;
}

/** Every stored or requested provider value resolves to Claude. */
export function normalizeLlmProvider(_value?: unknown): LlmProvider {
  return DEFAULT_LLM_PROVIDER;
}

/** Request boundaries must not silently route an unsupported vendor to Claude. */
export function requireLlmProvider(value: unknown): LlmProvider {
  if (value === undefined || value === null || value === '') return DEFAULT_LLM_PROVIDER;
  if (typeof value !== 'string' || value.trim().toLowerCase() !== DEFAULT_LLM_PROVIDER) {
    throw new Error('Unsupported LLM provider');
  }
  return DEFAULT_LLM_PROVIDER;
}

export function llmProviderPreset(_provider?: unknown): LlmProviderPreset {
  return LLM_PROVIDER_PRESETS[0];
}

/** Stable setting names. The key stays server-side; URL/model are non-secret config. */
export function llmProviderConfigNames(_provider?: unknown): LlmProviderConfigNames {
  return {
    apiKey: 'LLM_ANTHROPIC_API_KEY',
    baseUrl: 'LLM_ANTHROPIC_BASE_URL',
    model: 'LLM_ANTHROPIC_MODEL',
    legacyContextWindow: 'LLM_ANTHROPIC_CONTEXT_WINDOW',
  };
}

export function defaultModelForProvider(_provider?: unknown): string {
  return LLM_PROVIDER_PRESETS[0].defaultModel;
}

export function protocolForProvider(_provider?: unknown): LlmProtocol {
  return 'anthropic';
}

/** Claude request rules shared by browser and server model adapters. */
export function resolveModelRequestPolicy(
  _provider?: unknown,
  cacheMode: 'short' | 'long' = 'short',
): {
  protocol: LlmProtocol;
  providerOptions: SharedV4ProviderOptions;
  cacheTtlMs: number;
} {
  return {
    protocol: 'anthropic',
    providerOptions: {
      anthropic: {
        cacheControl: cacheMode === 'long' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' },
      },
    },
    cacheTtlMs: (cacheMode === 'long' ? 60 : 5) * 60 * 1000,
  };
}

export function providerApiPath(_provider?: unknown): string {
  return '/messages';
}
