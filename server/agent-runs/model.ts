import { createAnthropic } from '@ai-sdk/anthropic';
import type {
  LanguageModelV4,
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider';
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import type { AgentCacheMode } from '../../src/agent/settings/agentSettings';
import { resolveModelRequestPolicy, type LlmProvider } from '../../shared/llm-providers';

function proxyOptions(provider: LlmProvider, origin: string): {
  baseURL: string;
  apiKey: string;
  headers: Record<string, string>;
} {
  return {
    baseURL: `${origin}/llm`,
    apiKey: 'proxy-injects-the-real-key',
    headers: {
      'x-openchatcut-provider': provider,
      origin,
      'sec-fetch-site': 'same-origin',
    },
  };
}

/**
 * The AI SDK runs a step's tools only when it finishes with `stop` or `tool-calls`.
 * OpenAI-compatible gateways that end a tool-calling turn with a non-standard
 * finish_reason, or none, surface as `other`: the calls would go unexecuted and the
 * next request would fail with MissingToolResultsError. Report those steps as
 * `tool-calls`; `length`, `content-filter` and `error` keep the SDK's refusal.
 */
function toolCallFinishReason(
  finishReason: LanguageModelV4FinishReason,
  calledTools: boolean,
): LanguageModelV4FinishReason {
  return calledTools && finishReason.unified === 'other'
    ? { ...finishReason, unified: 'tool-calls' }
    : finishReason;
}

export const toolCallFinishReasonMiddleware: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    const calledTools = result.content.some((part) => (
      part.type === 'tool-call' && !part.providerExecuted
    ));
    return { ...result, finishReason: toolCallFinishReason(result.finishReason, calledTools) };
  },
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream();
    let calledTools = false;
    return {
      ...rest,
      stream: stream.pipeThrough(new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
        transform(part, controller) {
          if (part.type === 'tool-call' && !part.providerExecuted) calledTools = true;
          controller.enqueue(part.type === 'finish'
            ? { ...part, finishReason: toolCallFinishReason(part.finishReason, calledTools) }
            : part);
        },
      })),
    };
  },
};

/** Claude through the same local key-injecting proxy as the browser Agent. */
export function createServerLanguageModel(
  provider: LlmProvider,
  modelId: string,
  origin: string,
): LanguageModelV4 {
  return wrapLanguageModel({
    model: createAnthropic(proxyOptions(provider, origin))(modelId),
    middleware: toolCallFinishReasonMiddleware,
  });
}

export function serverProviderOptions(
  provider: LlmProvider,
  cacheMode: AgentCacheMode,
): SharedV4ProviderOptions | undefined {
  return resolveModelRequestPolicy(provider, cacheMode).providerOptions;
}
