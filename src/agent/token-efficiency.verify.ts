import assert from 'node:assert/strict';
import type { AgentContext } from './context';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { AgentToolSchema } from './tool-schema';
import { ToolActivation } from './tool-activation';
import { INITIAL } from '../editor/initial';
import { docFromTimeline } from '../persist/projectStore';
import { runApiAgent } from './api-runtime';
import { resolveModelCapabilities } from '../../shared/model-capabilities';
import { attachAgentArtifactRef } from './runtime-artifact';
import { projectLlmMessagesForPersistence } from './useAgentPersistence';
import type { LLMMessage } from './runtime';
import type { AgentContextUsage } from './context-compaction';

function verifyArchivedLlmPersistenceProjection(): void {
  const largePayload = 'nested-large-result-'.repeat(2_000);
  const liveResult = attachAgentArtifactRef({ payload: largePayload }, {
    artifactId: 'artifact-nested-persistence',
    bodySha256: 'a'.repeat(64),
    originalChars: largePayload.length,
    storedBytes: largePayload.length,
    redacted: false,
    binaryOmitted: false,
  });
  const userMessage: LLMMessage = { role: 'user', content: 'Keep this message by identity.' };
  const toolMessage: LLMMessage = {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: 'nested-artifact-call',
      toolName: 'read_project',
      output: { type: 'json', value: { nested: liveResult } },
    }],
  };
  const projected = projectLlmMessagesForPersistence([userMessage, toolMessage]);
  const savedJson = JSON.stringify(projected);
  assert.equal(projected[0], userMessage, 'non-tool messages keep their original identity');
  assert.notEqual(projected[1], toolMessage, 'only the affected tool message is copied');
  assert.equal(liveResult.payload, largePayload, 'live provider history remains unchanged');
  assert.equal(savedJson.includes(largePayload), false, 'chat JSON excludes the archived large payload');
  assert.ok(savedJson.includes('artifact-nested-persistence'), 'chat JSON retains the bounded artifact reference');
}

function verifySanitizedLlmPersistenceProjection(): void {
  const accessSecret = 'small-access-token-secret';
  const skillSecret = 'load-skill-credential-secret';
  const liveAccessResult = {
    ok: true,
    accessToken: accessSecret,
    error: 'Provider echoed password: small-error-echo-secret',
  };
  const liveSkillResult = {
    skill: 'credential-fixture',
    contents: {
      'SKILL.md': `# Credential fixture\nOPENAI_API_KEY=${skillSecret}\nKeep this instruction exact.`,
    },
  };
  const toolMessage: LLMMessage = {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'small-secret-call',
        toolName: 'read_project',
        output: { type: 'json', value: liveAccessResult },
      },
      {
        type: 'tool-result',
        toolCallId: 'load-skill-secret-call',
        toolName: 'load_skill',
        output: { type: 'json', value: liveSkillResult },
      },
    ],
  };
  const savedJson = JSON.stringify(projectLlmMessagesForPersistence([toolMessage]));
  assert.equal(liveAccessResult.accessToken, accessSecret, 'live small result remains exact');
  assert.equal(
    liveSkillResult.contents['SKILL.md'].includes(skillSecret),
    true,
    'live load_skill transport remains exact for the current request',
  );
  assert.doesNotMatch(
    savedJson,
    /small-access-token-secret|load-skill-credential-secret|small-error-echo-secret/,
  );
  assert.match(savedJson, /OPENAI_API_KEY=\[REDACTED\]/);
  assert.match(savedJson, /"accessToken":"\[REDACTED\]"/);
  assert.match(savedJson, /Provider echoed password: \[REDACTED\]/);
}


verifyArchivedLlmPersistenceProjection();
verifySanitizedLlmPersistenceProjection();

const schema = (name: string): AgentToolSchema => ({
  name,
  description: `${name} description`,
  input_schema: { type: 'object', properties: {} },
});
const catalog = [schema('ToolSearch'), schema('submit_export')];
const context: AgentContext = {
  commands: {} as AgentContext['commands'],
  getState: () => INITIAL,
  getDoc: () => docFromTimeline(INITIAL),
  getCreativeMode: () => null,
  templates: [],
  audio: [],
  getProjectId: () => 'token-test',
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
let apiPreparedTools: string[] = [];
const apiUsage = {
  inputTokens: { total: 12, noCache: 5, cacheRead: 7, cacheWrite: undefined },
  outputTokens: { total: 6, text: 4, reasoning: 2 },
};
const apiActivation = new ToolActivation(catalog, [{ role: 'user', content: 'Find a specialized publishing capability.' }]);
let apiReprepares = 0;
const persistedApiUsage: AgentContextUsage[] = [];
const persistedApiToolShapes: string[][] = [];
const apiResult = await runApiAgent(
  [{ role: 'user', content: 'Find a specialized publishing capability.' }],
  context,
  () => undefined,
  apiChoice,
  'Test system prompt.',
  false,
  1_000,
  {
    toolActivation: apiActivation,
    prepareContextForTools: async (messages, tools) => {
      apiReprepares += 1;
      apiPreparedTools = tools.flatMap((tool) => (
        tool && typeof tool === 'object' && 'name' in tool && typeof tool.name === 'string'
          ? [tool.name]
          : []
      ));
      return { messages: [...messages], compacted: false };
    },
    recordProviderContextUsage: async (usage, tools) => {
      await Promise.resolve();
      persistedApiUsage.push(usage);
      persistedApiToolShapes.push(tools.flatMap((tool) => (
        tool && typeof tool === 'object' && 'name' in tool && typeof tool.name === 'string'
          ? [tool.name]
          : []
      )));
    },
  },
  {
    model: new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              {
                type: 'tool-call',
                toolCallId: 'api-search',
                toolName: 'ToolSearch',
                input: '{"query":"export"}',
              },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: apiUsage },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'api-ready' },
              { type: 'text-delta', id: 'api-ready', delta: 'API tools are ready.' },
              { type: 'text-end', id: 'api-ready' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: apiUsage },
            ],
          }),
        },
      ],
    }),
  },
);
assert.equal(apiReprepares, 1, 'API re-budgets history after ToolSearch expands schemas');
assert.ok(apiPreparedTools.includes('submit_export'));
assert.equal(apiPreparedTools.includes('ToolSearch'), true,
  'API ToolSearch remains available for another discovery round');
assert.equal(persistedApiUsage.length, 2,
  'each API provider round persists usage before run completion');
assert.deepEqual(
  {
    input: persistedApiUsage.at(-1)?.inputTokens,
    output: persistedApiUsage.at(-1)?.outputTokens,
    reasoning: persistedApiUsage.at(-1)?.reasoningTokens,
    cache: persistedApiUsage.at(-1)?.cacheReadTokens,
    noCache: persistedApiUsage.at(-1)?.noCacheInputTokens,
  },
  { input: 12, output: 6, reasoning: 2, cache: 7, noCache: 5 },
);
assert.ok(persistedApiToolShapes.at(-1)?.includes('submit_export'),
  'API usage persistence receives the expanded request schema shape');
assert.match(JSON.stringify(apiResult.at(-1)?.content), /API tools are ready\./);

const apiStreamErrors: string[] = [];
const apiStreamErrorResult = await runApiAgent(
  [{ role: 'user', content: 'Trigger a provider stream error.' }],
  context,
  (event) => {
    if (event.type === 'error') apiStreamErrors.push(event.message);
  },
  apiChoice,
  'Test system prompt.',
  false,
  1_000,
  undefined,
  {
    model: new MockLanguageModelV4({
      doStream: {
        stream: simulateReadableStream({
          chunks: [{ type: 'error', error: new Error('provider stream failure test') }],
        }),
      },
    }),
  },
);
assert.equal(apiStreamErrorResult.length, 1, 'provider stream errors do not create fake responses');
assert.equal(apiStreamErrors.some((message) => message.includes('provider stream failure test')), true);

console.log('token efficiency checks passed');
