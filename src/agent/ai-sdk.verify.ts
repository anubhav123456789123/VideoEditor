import assert from 'node:assert/strict';
import {
  UnsupportedFunctionalityError,
  generateText,
  jsonSchema,
  simulateReadableStream,
  tool,
  type ModelMessage,
  type ToolResultPart,
} from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
  cacheTtlMsForProvider,
  defaultModelForProvider,
  getLanguageModel,
  getLanguageModelProviderOptions,
  normalizeLlmProvider,
  providerApiPath,
} from './client';
import { LLM_PROVIDER_PRESETS } from '../../shared/llm-providers';
import {
  makeMessagesPortable,
  normalizeLlmMessages,
  prepareMessagesForProvider,
  prepareChatCompletionsMediaMessages,
  withoutModelImages,
} from './messages';
import {
  apiToolExecutionOutput,
  isCompatibleMediaFallbackError,
  shouldRetryCompatibleMediaRequest,
  shouldRetryTransientAgentRequest,
  streamPartStartsCompatibleMediaOutput,
} from './runtime';
import type { AgentEvent } from './runtime';
import { runApiAgent } from './api-runtime';
import { resolveModelCapabilities } from '../../shared/model-capabilities';
import type { AgentContext } from './context';
import { INITIAL } from '../editor/initial';
import { docFromTimeline } from '../persist/projectStore';
import { isFailedToolResult, ToolFailureTracker } from './toolFailure';

// Claude is the only provider: every stored or requested value resolves to it.
assert.equal(normalizeLlmProvider('anthropic'), 'anthropic');
assert.equal(normalizeLlmProvider('openai'), 'anthropic');
assert.equal(normalizeLlmProvider('unexpected'), 'anthropic');
assert.equal(defaultModelForProvider('anthropic'), 'claude-opus-5-5');
assert.equal(providerApiPath('anthropic'), '/messages');
const strippedVisualMessages = withoutModelImages([{
  role: 'user',
  content: [
    { type: 'text', text: 'inspect this' },
    { type: 'file', data: new URL('https://example.invalid/frame.png'), mediaType: 'image/png' },
    { type: 'file', data: new URL('https://example.invalid/notes.pdf'), mediaType: 'application/pdf' },
  ],
}]);
const strippedVisualContent = strippedVisualMessages[0]!.content as Array<Record<string, unknown>>;
assert.equal(strippedVisualContent.some((part) => part.mediaType === 'image/png'), false,
  'models without image input never receive visual attachments');
assert.equal(strippedVisualContent.some((part) => part.mediaType === 'application/pdf'), true,
  'non-image files are not conflated with image capability');
assert.equal(strippedVisualContent.some((part) => String(part.text).includes('omitted')), true,
  'the model receives an explicit omission notice');
assert.equal((await getLanguageModel('anthropic', 'test-model')).provider, 'anthropic.messages');
assert.deepEqual(getLanguageModelProviderOptions('anthropic', 'short'), {
  anthropic: { cacheControl: { type: 'ephemeral' } },
});
assert.deepEqual(getLanguageModelProviderOptions('anthropic', 'long'), {
  anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
});
assert.equal(cacheTtlMsForProvider('anthropic', 'short'), 5 * 60 * 1000);
assert.equal(cacheTtlMsForProvider('anthropic', 'long'), 60 * 60 * 1000);
assert.equal(LLM_PROVIDER_PRESETS.length, 1);
for (const preset of LLM_PROVIDER_PRESETS) {
  assert.equal(normalizeLlmProvider(preset.id), preset.id);
  assert.equal(defaultModelForProvider(preset.id), preset.defaultModel);
  assert.doesNotThrow(() => new URL(preset.baseUrl));
}

// Exercise the real AI SDK provider serializers without making a network call.
// A controlled 400 is sufficient to capture each protocol's URL and request body.
const originalFetch = globalThis.fetch;
const serialized: Array<{ url: string; body: Record<string, unknown>; provider: string | null }> = [];
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  serialized.push({
    url,
    body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    provider: headers.get('x-openchatcut-provider'),
  });
  return new Response(JSON.stringify({
    type: 'error',
    error: { type: 'invalid_request_error', message: 'intentional test response' },
  }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
};
try {
  await assert.rejects(generateText({
    model: await getLanguageModel('anthropic', 'claude-test'),
    prompt: 'ping',
    maxRetries: 0,
  }));
} finally {
  globalThis.fetch = originalFetch;
}
assert.deepEqual(serialized.map(({ url, body, provider }) => ({
  path: new URL(url).pathname,
  model: body.model,
  provider,
})), [
  { path: '/llm/messages', model: 'claude-test', provider: 'anthropic' },
]);

const legacy = normalizeLlmMessages([
  { role: 'user', content: '把第一段放到时间线' },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'private reasoning', signature: 'sig' },
      { type: 'text', text: '开始处理。' },
      { type: 'tool_use', id: 'tool_1', name: 'edit_item', input: { itemId: 'a' } },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'tool_1', content: '{"ok":true}' },
    ],
  },
]);

assert.deepEqual(legacy, [
  { role: 'user', content: '把第一段放到时间线' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: '开始处理。' },
      { type: 'tool-call', toolCallId: 'tool_1', toolName: 'edit_item', input: { itemId: 'a' } },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'tool_1',
        toolName: 'edit_item',
        output: { type: 'text', value: '{"ok":true}' },
      },
    ],
  },
]);

assert.deepEqual(makeMessagesPortable([
  {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: 'hidden', providerOptions: { openai: { itemId: 'rs_1' } } },
      { type: 'text', text: 'visible', providerOptions: { openai: { itemId: 'msg_1' } } },
    ],
  },
]), [
  { role: 'assistant', content: [{ type: 'text', text: 'visible' }] },
]);

const compatibleAssistant: ModelMessage = {
  role: 'assistant',
  providerOptions: { moonshotai: { history: 'keep' } },
  content: [{
    type: 'reasoning',
    text: 'provider reasoning',
    providerOptions: { moonshotai: { reasoningContent: 'keep' } },
  }],
};
const compatibleTextResult: ToolResultPart = {
  type: 'tool-result',
  toolCallId: 'text_call',
  toolName: 'inspect_metadata',
  providerOptions: { moonshotai: { result: 'keep' } },
  output: {
    type: 'text',
    value: 'metadata only',
    providerOptions: { moonshotai: { output: 'keep' } },
  },
};
const compatibleTextTool: ModelMessage = {
  role: 'tool',
  providerOptions: { moonshotai: { message: 'keep' } },
  content: [compatibleTextResult],
};
const compatibleFileResultA: ToolResultPart = {
  type: 'tool-result',
  toolCallId: 'frame_call_a',
  toolName: 'view_asset_frames',
  providerOptions: { moonshotai: { result: 'keep-a' } },
  output: {
    type: 'content',
    value: [{
      type: 'file',
      data: { type: 'data', data: 'compatible-jpeg-a' },
      mediaType: 'image/jpeg',
      filename: 'frame-a.jpg',
      providerOptions: { moonshotai: { file: 'keep-a' } },
    }],
  },
};
const compatibleFileResultB: ToolResultPart = {
  type: 'tool-result',
  toolCallId: 'frame_call_b',
  toolName: 'view_asset_frames',
  providerOptions: { moonshotai: { result: 'keep-b' } },
  output: {
    type: 'content',
    value: [
      { type: 'text', text: 'frame b metadata', providerOptions: { moonshotai: { text: 'keep-b' } } },
      {
        type: 'file',
        data: { type: 'data', data: 'compatible-jpeg-b' },
        mediaType: 'image/jpeg',
      },
    ],
  },
};
const compatibleFileToolA: ModelMessage = {
  role: 'tool',
  providerOptions: { moonshotai: { message: 'keep-a' } },
  content: [compatibleFileResultA],
};
const compatibleFileToolB: ModelMessage = {
  role: 'tool',
  providerOptions: { moonshotai: { message: 'keep-b' } },
  content: [compatibleFileResultB],
};
const compatibleMediaPreparation = prepareChatCompletionsMediaMessages([
  compatibleAssistant,
  compatibleTextTool,
  compatibleFileToolA,
  compatibleFileToolB,
]);
const compatibleChatHistory = compatibleMediaPreparation.messages;
assert.equal(compatibleMediaPreparation.movedMedia, true);
assert.equal(compatibleChatHistory.length, 5);
assert.strictEqual(compatibleChatHistory[0], compatibleAssistant);
assert.strictEqual(compatibleChatHistory[1], compatibleTextTool);
assert.strictEqual(
  (compatibleChatHistory[1] as Extract<ModelMessage, { role: 'tool' }>).content[0],
  compatibleTextResult,
);
assert.deepEqual(compatibleChatHistory.slice(2), [
  {
    ...compatibleFileToolA,
    content: [{
      ...compatibleFileResultA,
      output: {
        type: 'text',
        value: 'Rendered media is attached in the following user message.',
      },
    }],
  },
  {
    ...compatibleFileToolB,
    content: [{
      ...compatibleFileResultB,
      output: {
        type: 'text',
        value: 'frame b metadata',
        providerOptions: { moonshotai: { text: 'keep-b' } },
      },
    }],
  },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Rendered media returned by the preceding tool calls:' },
      {
        type: 'file',
        data: { type: 'data', data: 'compatible-jpeg-a' },
        mediaType: 'image/jpeg',
        filename: 'frame-a.jpg',
        providerOptions: { moonshotai: { file: 'keep-a' } },
      },
      {
        type: 'file',
        data: { type: 'data', data: 'compatible-jpeg-b' },
        mediaType: 'image/jpeg',
      },
    ],
  },
]);

const compatibleTextOnlyHistory = compatibleMediaPreparation.messagesWithoutMedia;
assert.equal(compatibleTextOnlyHistory.length, 4);
assert.strictEqual(compatibleTextOnlyHistory[0], compatibleAssistant);
assert.strictEqual(compatibleTextOnlyHistory[1], compatibleTextTool);
assert.deepEqual(compatibleTextOnlyHistory.slice(2), [
  {
    ...compatibleFileToolA,
    content: [{
      ...compatibleFileResultA,
      output: {
        type: 'text',
        value: 'Rendered media was omitted because the selected model does not accept visual attachments.',
      },
    }],
  },
  {
    ...compatibleFileToolB,
    content: [{
      ...compatibleFileResultB,
      output: {
        type: 'text',
        value: 'frame b metadata',
        providerOptions: { moonshotai: { text: 'keep-b' } },
      },
    }],
  },
]);
for (const message of compatibleTextOnlyHistory) {
  if (message.role === 'user' && Array.isArray(message.content)) {
    assert.equal(message.content.some((part) => part.type === 'file'), false);
  }
  if (message.role === 'tool') {
    for (const part of message.content) {
      if (part.type === 'tool-result') assert.notEqual(part.output.type, 'content');
    }
  }
}

const compatibleNoMediaPreparation = prepareChatCompletionsMediaMessages([
  compatibleAssistant,
  compatibleTextTool,
]);
assert.equal(compatibleNoMediaPreparation.movedMedia, false);
assert.strictEqual(compatibleNoMediaPreparation.messages[0], compatibleAssistant);
assert.strictEqual(compatibleNoMediaPreparation.messages[1], compatibleTextTool);
assert.strictEqual(compatibleNoMediaPreparation.messagesWithoutMedia[0], compatibleAssistant);
assert.strictEqual(compatibleNoMediaPreparation.messagesWithoutMedia[1], compatibleTextTool);

const retryable400 = {
  protocol: 'openai-compatible',
  movedMedia: true,
  retryAttempted: false,
  outputStarted: false,
  aborted: false,
  error: { statusCode: 400 },
};
const unsupportedImageInput = new UnsupportedFunctionalityError({
  functionality: 'image input',
});
assert.equal(streamPartStartsCompatibleMediaOutput('error'), false);
assert.equal(streamPartStartsCompatibleMediaOutput('abort'), false);
assert.equal(streamPartStartsCompatibleMediaOutput('text-start'), true);
assert.equal(streamPartStartsCompatibleMediaOutput('reasoning-delta'), true);
assert.equal(streamPartStartsCompatibleMediaOutput('tool-input-start'), true);
assert.equal(isCompatibleMediaFallbackError(unsupportedImageInput), true);
assert.equal(isCompatibleMediaFallbackError({ status: 400 }), true);
assert.equal(shouldRetryCompatibleMediaRequest(retryable400), true);
assert.equal(shouldRetryCompatibleMediaRequest({
  ...retryable400,
  error: unsupportedImageInput,
}), true);
assert.equal(shouldRetryCompatibleMediaRequest({ ...retryable400, retryAttempted: true }), false);
for (const statusCode of [401, 403, 404, 429, 500, 503]) {
  assert.equal(shouldRetryCompatibleMediaRequest({
    ...retryable400,
    error: { statusCode },
  }), false);
}
assert.equal(shouldRetryCompatibleMediaRequest({
  ...retryable400,
  error: Object.assign(new Error('aborted'), { name: 'AbortError', statusCode: 400 }),
}), false);
assert.equal(shouldRetryCompatibleMediaRequest({ ...retryable400, aborted: true }), false);
assert.equal(shouldRetryCompatibleMediaRequest({ ...retryable400, outputStarted: true }), false);
assert.equal(shouldRetryCompatibleMediaRequest({ ...retryable400, movedMedia: false }), false);
for (const protocol of ['openai', 'anthropic', 'google']) {
  assert.equal(shouldRetryCompatibleMediaRequest({ ...retryable400, protocol }), false);
}

assert.deepEqual(makeMessagesPortable([compatibleFileToolA]), [{
  role: 'tool',
  content: [{
    type: 'tool-result',
    toolCallId: 'frame_call_a',
    toolName: 'view_asset_frames',
    output: {
      type: 'content',
      value: [{
        type: 'file',
        data: { type: 'data', data: 'compatible-jpeg-a' },
        mediaType: 'image/jpeg',
        filename: 'frame-a.jpg',
      }],
    },
  }],
}]);
const nativeMediaHistory = prepareMessagesForProvider(
  [compatibleFileToolA],
  'anthropic',
  'anthropic',
);
assert.equal(nativeMediaHistory.length, 1);
assert.strictEqual(nativeMediaHistory[0], compatibleFileToolA);

assert.equal(shouldRetryTransientAgentRequest({
  retryAttempted: false,
  outputStarted: false,
  aborted: false,
  error: Object.assign(new Error('temporary gateway failure'), { statusCode: 502 }),
}), true, 'retry one transient gateway failure before output starts');
assert.equal(shouldRetryTransientAgentRequest({
  retryAttempted: false,
  outputStarted: false,
  aborted: false,
  error: new TypeError('Failed to fetch'),
}), true, 'retry a canonical browser fetch failure before output starts');
assert.equal(shouldRetryTransientAgentRequest({
  retryAttempted: false,
  outputStarted: false,
  aborted: false,
  error: Object.assign(new Error('request aborted'), { name: 'AbortError' }),
}), false, 'never retry an aborted browser request');
assert.equal(shouldRetryTransientAgentRequest({
  retryAttempted: false,
  outputStarted: false,
  aborted: false,
  error: Object.assign(new Error('bad request'), { statusCode: 400 }),
}), false, 'do not retry permanent request failures');
assert.equal(shouldRetryTransientAgentRequest({
  retryAttempted: false,
  outputStarted: true,
  aborted: false,
  error: Object.assign(new Error('late gateway failure'), { statusCode: 502 }),
}), false, 'do not duplicate a request after visible output starts');
assert.equal(shouldRetryTransientAgentRequest({
  retryAttempted: true,
  outputStarted: false,
  aborted: false,
  error: Object.assign(new Error('second gateway failure'), { statusCode: 503 }),
}), false, 'a transient request retries at most once');

assert.equal(isFailedToolResult({ ok: false, error: 'unknown item' }), true);
assert.equal(isFailedToolResult({ error: 'invalid edit_item input' }), true);
assert.equal(isFailedToolResult({ ok: true, error: 'non-fatal diagnostic' }), false);
assert.equal(isFailedToolResult({ success: true, result: null }), false);
assert.throws(
  () => apiToolExecutionOutput({
    success: false,
    result: { ok: false, error: 'updates[0]: item not found' },
  }),
  /updates\[0\]: item not found/,
  'API tools must surface rejected result envelopes as AI SDK tool errors',
);
assert.deepEqual(
  apiToolExecutionOutput({ success: true, result: { ok: true, changed: 1 } }),
  { ok: true, changed: 1 },
);

const sdkToolFailure = await generateText({
  model: new MockLanguageModelV4({
    doGenerate: {
      content: [{
        type: 'tool-call',
        toolCallId: 'failed-edit',
        toolName: 'edit_item',
        input: '{"updates":[{"itemId":"missing"}]}',
      }],
      finishReason: { unified: 'tool-calls', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    },
  }),
  prompt: 'Edit a missing clip.',
  tools: {
    edit_item: tool({
      inputSchema: jsonSchema({ type: 'object' }),
      execute: async () => apiToolExecutionOutput({
        success: false,
        result: { ok: false, error: 'updates[0]: item not found' },
      }),
    }),
  },
  maxRetries: 0,
});
assert.equal(
  sdkToolFailure.steps[0]?.content.some((part) => part.type === 'tool-error'),
  true,
  'AI SDK must preserve rejected OpenChatCut results as tool-error parts',
);

const apiContext: AgentContext = {
  commands: {} as AgentContext['commands'],
  getState: () => INITIAL,
  getDoc: () => docFromTimeline(INITIAL),
  getCreativeMode: () => null,
  templates: [],
  audio: [],
  getProjectId: () => 'project-1',
};
const apiChoice = {
  id: 'anthropic:claude-opus-5-5',
  backend: 'api',
  provider: 'anthropic',
  providerLabel: 'Claude',
  model: 'claude-opus-5-5',
  capabilities: resolveModelCapabilities({
    backend: 'api',
    provider: 'anthropic',
    modelId: 'claude-opus-5-5',
  }),
} as const;
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

const missingUsageEvents: AgentEvent[] = [];
await runApiAgent(
  [{ role: 'user', content: 'Answer briefly.' }],
  apiContext,
  (event) => missingUsageEvents.push(event),
  apiChoice,
  'Test system prompt.',
  false,
  1_000,
  undefined,
  {
    model: new MockLanguageModelV4({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'missing-usage-text' },
            { type: 'text-delta', id: 'missing-usage-text', delta: 'OK' },
            { type: 'text-end', id: 'missing-usage-text' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: {
                  total: undefined,
                  noCache: undefined,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: undefined, text: undefined, reasoning: undefined },
              },
            },
          ],
        }),
      },
    }),
  },
);
const estimatedProviderUsage = missingUsageEvents.find(
  (event): event is Extract<AgentEvent, { type: 'context-usage' }> => event.type === 'context-usage',
)?.usage;
assert.equal(estimatedProviderUsage?.requestIndex, 1);
assert.equal(estimatedProviderUsage?.isEstimated, true);
assert.ok((estimatedProviderUsage?.inputTokens ?? 0) > 0,
  'providers without usage metadata still emit estimated request telemetry');
assert.ok((estimatedProviderUsage?.outputTokens ?? 0) > 0,
  'providers without usage metadata still estimate output telemetry');
const apiFailureModel = new MockLanguageModelV4({
  doStream: [
    {
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'premature-success' },
          { type: 'text-delta', id: 'premature-success', delta: 'Removed the clip successfully.' },
          { type: 'text-end', id: 'premature-success' },
          {
            type: 'tool-call',
            toolCallId: 'remove-missing',
            toolName: 'remove_item',
            input: '{"itemId":"missing"}',
          },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage,
          },
        ],
      }),
    },
    {
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'different-tool-success' },
          { type: 'text-delta', id: 'different-tool-success', delta: 'The operation is now fixed.' },
          { type: 'text-end', id: 'different-tool-success' },
          {
            type: 'tool-call',
            toolCallId: 'read-after-failure',
            toolName: 'read_project',
            input: '{}',
          },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage,
          },
        ],
      }),
    },
    {
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'false-success' },
          { type: 'text-delta', id: 'false-success', delta: 'Removed the clip successfully.' },
          { type: 'text-end', id: 'false-success' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage,
          },
        ],
      }),
    },
  ],
});
const apiFailureEvents: AgentEvent[] = [];
const apiFailureResult = await runApiAgent(
  [{ role: 'user', content: 'Remove a missing clip.' }],
  apiContext,
  (event) => apiFailureEvents.push(event),
  apiChoice,
  'Test system prompt.',
  false,
  1_000,
  undefined,
  { model: apiFailureModel },
);
assert.match(
  JSON.stringify(apiFailureResult),
  /Removed the clip successfully|operation is now fixed/,
  'API history must keep assistant text after an unresolved tool error',
);
assert.match(JSON.stringify(apiFailureResult.at(-1)), /Removed the clip successfully/, 'final reply is the model\'s own text');
assert.doesNotMatch(JSON.stringify(apiFailureResult), /couldn't complete the requested operation|有工具调用失败/, 'no failure-report template is injected; the model replies freely');
assert.match(
  apiFailureEvents
    .filter((event): event is Extract<AgentEvent, { type: 'text-delta' }> => event.type === 'text-delta')
    .map((event) => event.delta)
    .join(''),
  /Removed the clip successfully|operation is now fixed/,
);

const maxTurnModel = new MockLanguageModelV4({
  doStream: Array.from({ length: 30 }, (_, index) => ({
    stream: simulateReadableStream({
      chunks: [
        {
          type: 'tool-call' as const,
          toolCallId: `remove-missing-${index}`,
          toolName: 'remove_item',
          input: '{"itemId":"missing"}',
        },
        {
          type: 'finish' as const,
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage,
        },
      ],
    }),
  })),
});
const maxTurnFailures = new ToolFailureTracker();
const maxTurnEvents: AgentEvent[] = [];
const maxTurnResult = await runApiAgent(
  [{ role: 'user', content: 'Keep removing the missing clip.' }],
  apiContext,
  (event) => maxTurnEvents.push(event),
  apiChoice,
  'Test system prompt.',
  false,
  1_000,
  { toolFailures: maxTurnFailures },
  { model: maxTurnModel },
);
assert.equal(
  maxTurnEvents.some((event) => event.type === 'max-turns'),
  true,
  'repeated failed tools must terminate at the tool-turn limit',
);
assert.doesNotMatch(JSON.stringify(maxTurnResult), /couldn't complete the requested operation|有工具调用失败/, 'max-turn close emits no failure-report template');
assert.equal(maxTurnFailures.hasUnresolved, false, 'max-turn failure reporting must close the tracker');

const abortFailures = new ToolFailureTracker();
abortFailures.record('edit_item', { success: false, result: { error: 'pending failure' } });
const abortController = new AbortController();
abortController.abort();
const abortResult = await runApiAgent(
  [{ role: 'user', content: 'Stop this turn.' }],
  apiContext,
  () => undefined,
  apiChoice,
  'Test system prompt.',
  false,
  1_000,
  { signal: abortController.signal, toolFailures: abortFailures },
  {
    model: new MockLanguageModelV4({
      doStream: async () => {
        throw new DOMException('Stopped', 'AbortError');
      },
    }),
  },
);
assert.equal(abortResult.length, 1);
assert.equal(abortFailures.hasUnresolved, false, 'aborting a turn must discard its failure state');

const toolFailures = new ToolFailureTracker();
toolFailures.record('edit_item', { success: false, result: { error: 'bad item id' } });
toolFailures.record('read_project', { success: true, result: { ok: true } });
assert.equal(toolFailures.hasUnresolved, true, 'another tool cannot erase an edit failure');
assert.match(toolFailures.report(), /edit_item: bad item id/);
toolFailures.record('edit_item', { success: true, result: { ok: true } });
assert.equal(toolFailures.hasUnresolved, false, 'a successful same-tool retry resolves the failure');

toolFailures.record('edit_item', { success: false, result: { error: 'retry failed' } });
toolFailures.record('edit_item', { success: true, result: { denied: true } });
assert.equal(toolFailures.hasUnresolved, true, 'a denied retry cannot resolve an earlier failure');
const persistedFailures = toolFailures.snapshot();
const restoredFailures = new ToolFailureTracker();
restoredFailures.restore(persistedFailures);
assert.match(restoredFailures.report(), /edit_item: retry failed/);
restoredFailures.clear();
assert.equal(restoredFailures.hasUnresolved, false);
console.log('ai-sdk checks passed');
