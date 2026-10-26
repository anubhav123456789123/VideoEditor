import type { ClaudeCodeAgentModel, ClaudeCodeAgentStatus } from '../../shared/claude-code-agent';
import { loadAgentModelPref, saveAgentModelPref } from '../persist/sessionPrefs';
import {
  LLM_PROVIDER_PRESETS,
  defaultModelForProvider,
  llmProviderConfigNames,
  type LlmProvider,
} from '../../shared/llm-providers';
import {
  MODEL_CAPABILITY_OVERRIDES_KEY,
  parseModelCapabilityOverrides,
  resolveModelCapabilities,
  type ModelCapabilities,
  type ModelCapabilityOverride,
  type ModelIdentity,
} from '../../shared/model-capabilities';
import { setLlmConfig } from './providerConfig';

/** Current Claude models offered in the model picker after the saved one. */
const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'] as const;

interface KeyStateLike {
  readonly configured: boolean;
}

export interface AgentModelChoice {
  readonly id: string;
  readonly backend: 'api' | 'claude-code';
  readonly provider: LlmProvider;
  readonly providerLabel: string;
  readonly model: string;
  readonly requestModel?: string;
  readonly capabilities: ModelCapabilities;
}

export interface AgentModelSnapshot {
  readonly choices: readonly AgentModelChoice[];
  readonly activeId: string;
  readonly loaded: boolean;
}

let snapshot: AgentModelSnapshot = { choices: [], activeId: '', loaded: false };
let apiModelChoices: readonly AgentModelChoice[] = [];
let claudeCodeModelChoices: readonly AgentModelChoice[] = [];
let capabilityOverrides: readonly ModelCapabilityOverride[] = [];
let claudeCodeStatus: ClaudeCodeAgentStatus | null = null;
let claudeCodeSavedModel = '';
let claudeCodeDiscoveredModels: readonly ClaudeCodeAgentModel[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function commit(choices: readonly AgentModelChoice[], activeId: string, loaded = snapshot.loaded): void {
  snapshot = { choices, activeId, loaded };
  emit();
}

function commitChoices(
  choices: readonly AgentModelChoice[],
  activeId: string,
  loaded = snapshot.loaded,
  fallbackApi?: AgentModelChoice,
): void {
  const active = choices.find((choice) => choice.id === activeId);
  const runtimeApi = active?.backend === 'api' ? active : fallbackApi;
  if (runtimeApi) {
    setLlmConfig(runtimeApi.provider, runtimeApi.model);
  }
  commit(choices, activeId, loaded);
}

function safeOverrides(raw: unknown): readonly ModelCapabilityOverride[] {
  try { return parseModelCapabilityOverrides(raw); } catch { return []; }
}

function modelCapabilities(identity: ModelIdentity): ModelCapabilities {
  return resolveModelCapabilities(identity, capabilityOverrides);
}

function apiChoices(
  keys: Record<string, KeyStateLike>,
  models: Record<string, string>,
): readonly AgentModelChoice[] {
  const preset = LLM_PROVIDER_PRESETS[0];
  const names = llmProviderConfigNames(preset.id);
  if (!keys[names.apiKey]?.configured) return [];
  const savedModel = models[names.model]?.trim() || defaultModelForProvider(preset.id);
  return [...new Set([savedModel, ...CLAUDE_MODELS])].map((model) => {
    const identity: ModelIdentity = { backend: 'api', provider: preset.id, modelId: model };
    return {
      id: `${preset.id}:${model}`,
      backend: 'api',
      provider: preset.id as LlmProvider,
      providerLabel: preset.label,
      model,
      capabilities: modelCapabilities(identity),
    };
  });
}

function chooseInitialApiId(choices: readonly AgentModelChoice[]): string {
  return choices[0]?.id ?? '';
}

function allChoices(): readonly AgentModelChoice[] {
  return [
    ...apiModelChoices,
    ...claudeCodeModelChoices,
  ];
}
function rebuildClaudeCodeChoices(): void {
  if (!claudeCodeStatus?.installed || claudeCodeStatus.account?.loggedIn !== true) {
    claudeCodeModelChoices = [];
    return;
  }
  const savedModel = claudeCodeSavedModel.trim();
  const entries = claudeCodeDiscoveredModels.length > 0
    ? claudeCodeDiscoveredModels
    : (savedModel ? [{ id: savedModel, label: savedModel, isDefault: false }] : []);
  claudeCodeModelChoices = entries.map((entry) => {
    const requested = entry.id === claudeCodeSavedModel;
    const identity: ModelIdentity = { backend: 'claude-code', provider: 'anthropic', modelId: entry.id };
    return {
      id: `claude-code:${entry.id}`,
      backend: 'claude-code',
      provider: 'anthropic',
      providerLabel: 'Claude Code',
      model: entry.id,
      ...(requested ? { requestModel: entry.id } : {}),
      capabilities: modelCapabilities(identity),
    };
  });
}
export function applyAgentModelStatus(
  keys: Record<string, KeyStateLike>,
  models: Record<string, string>,
): void {
  capabilityOverrides = safeOverrides(models[MODEL_CAPABILITY_OVERRIDES_KEY]);
  apiModelChoices = apiChoices(keys, models);
  claudeCodeSavedModel = models.CLAUDE_CODE_MODEL?.trim() ?? claudeCodeSavedModel;
  rebuildClaudeCodeChoices();
  const choices = allChoices();
  const initialApiId = chooseInitialApiId(apiModelChoices);
  const preferred = loadAgentModelPref();
  const preserved = choices.some((choice) => choice.id === preferred) ? preferred
    : choices.some((choice) => choice.id === snapshot.activeId) ? snapshot.activeId : '';
  commitChoices(
    choices,
    preserved || initialApiId || claudeCodeModelChoices[0]?.id || choices[0]?.id || '',
    true,
    apiModelChoices.find((choice) => choice.id === initialApiId),
  );
}

export function applyClaudeCodeAgentStatus(
  status: ClaudeCodeAgentStatus,
  savedModel?: string,
  discoveredModels?: readonly ClaudeCodeAgentModel[],
): void {
  claudeCodeStatus = status;
  claudeCodeSavedModel = savedModel?.trim() ?? claudeCodeSavedModel;
  if (discoveredModels) claudeCodeDiscoveredModels = discoveredModels;
  rebuildClaudeCodeChoices();
  const choices = allChoices();
  const preferred = loadAgentModelPref();
  const preserved = choices.some((choice) => choice.id === preferred) ? preferred
    : choices.some((choice) => choice.id === snapshot.activeId) ? snapshot.activeId : '';
  commitChoices(choices, preserved || claudeCodeModelChoices[0]?.id || choices[0]?.id || '', true);
}

export function getAgentModelSnapshot(): AgentModelSnapshot {
  return snapshot;
}

export function subscribeAgentModels(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isAgentModelReady(state: AgentModelSnapshot = snapshot): boolean {
  return state.loaded
    && Boolean(state.activeId)
    && state.choices.some((choice) => choice.id === state.activeId);
}

export function getActiveAgentModelChoice(): AgentModelChoice | undefined {
  return snapshot.choices.find((choice) => choice.id === snapshot.activeId);
}

export function selectAgentModel(id: string): void {
  const choice = snapshot.choices.find((candidate) => candidate.id === id);
  if (!choice) return;
  commitChoices(snapshot.choices, choice.id);
  saveAgentModelPref(id);
}
