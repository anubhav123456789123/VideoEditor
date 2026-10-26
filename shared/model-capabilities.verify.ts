import assert from 'node:assert/strict';
import {
  listVisionModels,
  resolveModelCapabilities,
  type ModelIdentity,
} from './model-capabilities';

const identity = (provider: string, modelId: string): ModelIdentity => ({
  backend: 'api',
  provider,
  modelId,
} as unknown as ModelIdentity);

// Exact catalog entries resolve with their declared window.
const exact = resolveModelCapabilities(identity('anthropic', 'claude-opus-5-5'));
assert.equal(exact.contextWindowTokens.value, 1_000_000, 'claude-opus-5-5 carries its 1M window');
assert.equal(exact.contextWindowTokens.source, 'catalog', 'catalog source, not fallback');
assert.equal(exact.maxOutputTokens.value, 128_000);
assert.equal(exact.supportsTools.value, true);

// Snapshot ids share the base model's entry.
const snapshot = resolveModelCapabilities(identity('anthropic', 'claude-opus-5-5-20261001'));
assert.equal(snapshot.contextWindowTokens.value, 1_000_000, 'snapshot matches its base model');
assert.equal(snapshot.contextWindowTokens.source, 'catalog', 'snapshot still counts as catalog');
assert.equal(snapshot.maxOutputTokens.value, 128_000, 'snapshot inherits max output');
assert.equal(snapshot.supportsImages.value, true, 'snapshot inherits image support');

// Longest prefix wins when several bases share the prefix (claude-opus-5 vs claude-opus-5-5).
const longest = resolveModelCapabilities(identity('anthropic', 'claude-opus-5-5-preview'));
assert.deepEqual(longest.maxOutputTokens, exact.maxOutputTokens, 'prefix matching finds the longest base entry');

// Unknown ids still fall back (no crash) with the statistically grounded
// estimate, marked estimated so the UI can prompt for manual adjustment.
const unknown = resolveModelCapabilities(identity('anthropic', 'definitely-not-a-model'));
assert.equal(unknown.contextWindowTokens.source, 'provider-fallback', 'unknown id falls back');
assert.equal(unknown.contextWindowTokens.estimated, true, 'fallback is marked estimated');
assert.equal(unknown.contextWindowTokens.value, 409_600, 'fallback context uses the catalog-grounded estimate');
assert.equal(unknown.maxOutputTokens.value, 65_536, 'fallback output uses the catalog-grounded estimate');

// Every current Claude model is offered for vision.
for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']) {
  assert.ok(listVisionModels('anthropic').includes(model), `${model} reaches the multimodal path`);
}

// User overrides still win over the catalog.
const opus = identity('anthropic', 'claude-opus-5-5');
assert.equal(resolveModelCapabilities(opus, [{ ...opus, supportsTools: false }]).supportsTools.value,
  false, 'user overrides still win');

console.log('model-capabilities.verify: snapshot prefix matching passed');
