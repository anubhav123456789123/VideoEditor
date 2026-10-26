import {
  DEFAULT_LLM_PROVIDER,
  defaultModelForProvider,
  normalizeLlmProvider,
  protocolForProvider,
  providerApiPath,
  type LlmProvider,
} from '../../shared/llm-providers';

export {
  DEFAULT_LLM_PROVIDER,
  defaultModelForProvider,
  normalizeLlmProvider,
  protocolForProvider,
  providerApiPath,
};
export type { LlmProvider };

export let PROVIDER: LlmProvider = DEFAULT_LLM_PROVIDER;
export let MODEL = defaultModelForProvider(PROVIDER);

export function setLlmConfig(provider: unknown, model: unknown): void {
  PROVIDER = normalizeLlmProvider(provider);
  MODEL = typeof model === 'string' && model.trim()
    ? model.trim()
    : defaultModelForProvider(PROVIDER);
}

export function setLlmModel(model: string): void {
  setLlmConfig(PROVIDER, model);
}

export function setLlmProvider(provider: unknown): void {
  setLlmConfig(provider, '');
}
