// Shared OpenChatCut tool execution boundary: argument policy, run-ledger
// records, abort handling, timeline deltas and artifact capture around one
// editor tool call. Used by the Claude agent runtime and Claude Code turns.
import type { AgentContext } from './context';
import type { AgentEvent } from './runtime';
import type { AgentToolSchema } from './tool-schema';
import type { AgentSettings } from './settings/agentSettings';
import type { AgentRunRecorder } from './runtime-ledger';
import type { HarnessToolExecutionContext } from './harness-context';
import type { AgentToolOutcome } from '../persist/agentRuntimeStore';
import type { TimelineSnapshot } from './timelineDelta';
import { executeTool as executeEditorTool } from './tools';
import { describeTimelineDelta, snapshotTimeline } from './timelineDelta';
import { isFailedToolResult } from './toolFailure';
import {
  effectiveToolInvocationArgs,
  policyForTool,
  validateAgentToolInvocation,
  type ToolExecutionPolicy,
} from './execution-policy';
import { digestAgentToolArgs, TOOL_ARTIFACT_THRESHOLD } from './runtime-ledger';
import {
  artifactPlaceholder,
  attachAgentArtifactRef,
  sanitizeJsonForArtifact,
} from './runtime-artifact';
import { sha256Text } from '../persist/agentRuntimeStore';

export interface ToolExecution {
  readonly success: boolean;
  readonly result: unknown;
  readonly followupText?: string;
  readonly refreshTools?: boolean;
}

export interface LocalToolExecutionContext {
  readonly ctx: AgentContext;
  readonly onEvent: (event: AgentEvent) => void;
  readonly settings: AgentSettings;
  readonly onFollowup?: (text: string) => void;
  readonly toolCatalog?: readonly AgentToolSchema[];
  readonly activeToolCatalog?: readonly AgentToolSchema[];
  readonly harness?: HarnessToolExecutionContext;
  readonly runRecorder?: AgentRunRecorder;
  readonly toolCallId?: string;
  readonly signal?: AbortSignal;
  /** Focused verification seam; production uses the canonical lazy tool dispatcher. */
  readonly executeTool?: typeof executeEditorTool;
}

interface ToolBoundaryState {
  readonly toolCallId: string;
  invocationArgs: Record<string, unknown>;
  policy: ToolExecutionPolicy;
  argsDigest?: string;
  operationId?: string;
  before?: TimelineSnapshot;
  started: boolean;
}
class ToolBoundaryError extends Error {
  readonly outcome: AgentToolOutcome;
  constructor(message: string, outcome: AgentToolOutcome) {
    super(message);
    this.outcome = outcome;
  }
}

function throwIfToolAborted(signal: AbortSignal | undefined, state: ToolBoundaryState): void {
  if (!signal?.aborted) return;
  const outcome: AgentToolOutcome = state.started
    ? { kind: 'outcome_unknown', operationId: state.operationId ?? state.toolCallId }
    : { kind: 'aborted_before_side_effect' };
  throw new ToolBoundaryError('Tool execution was stopped.', outcome);
}

async function prepareToolBoundary(
  schema: AgentToolSchema,
  args: Record<string, unknown>,
  execution: LocalToolExecutionContext,
  state: ToolBoundaryState,
): Promise<null> {
  const active = execution.activeToolCatalog ?? execution.toolCatalog ?? [schema];
  const validation = validateAgentToolInvocation(schema, args, active);
  if (!validation.ok) {
    throw new ToolBoundaryError(validation.error, {
      kind: 'validation_failed', summary: validation.issues.join('; ').slice(0, 1_000),
    });
  }
  // validation.args is the normalized form that passed the schema; recording and executing
  // it keeps the ledger consistent with what the tool actually ran.
  state.invocationArgs = effectiveToolInvocationArgs(schema.name, validation.args);
  state.policy = policyForTool(schema.name, state.invocationArgs);
  state.argsDigest = execution.runRecorder
    ? (await execution.runRecorder.recordToolRequested({
      toolCallId: state.toolCallId, toolName: schema.name, args: state.invocationArgs,
    })).argsDigest
    : await digestAgentToolArgs(state.invocationArgs);
  return null;
}
function toolFollowupText(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || !('__followup' in result) || typeof result.__followup !== 'string') return null;
  return result.__followup;
}

async function settleToolResult(
  schema: AgentToolSchema,
  args: Record<string, unknown>,
  rawResult: unknown,
  execution: LocalToolExecutionContext,
  state: ToolBoundaryState,
): Promise<ToolExecution> {
  throwIfToolAborted(execution.signal, state);
  const changed = state.before ? describeTimelineDelta(state.before, execution.ctx.getState()) : null;
  const enriched = changed && rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
    ? { ...(rawResult as Record<string, unknown>), changed } : rawResult;
  const sanitized = sanitizeJsonForArtifact(enriched);
  if (!sanitized) throw new Error('tool_result_archive: result could not be serialized safely');
  const archiveExempt = schema.name === 'read_agent_artifact' || schema.name === 'load_skill';
  const requiresArchive = !archiveExempt && sanitized.originalChars > TOOL_ARTIFACT_THRESHOLD;
  const ref = await execution.runRecorder?.archiveToolResult({
    toolCallId: state.toolCallId, toolName: schema.name, result: enriched,
  });
  throwIfToolAborted(execution.signal, state);
  // Server-run executions have no browser recorder: their results travel the
  // server settle channel, which enforces its own event-size cap with an
  // omitted+digest fallback (store-values durableEventData). The archive
  // requirement only applies when a recorder is wired and the result would
  // otherwise be dropped from the model context.
  if (requiresArchive && execution.runRecorder && !ref) {
    throw new Error('tool_result_archive: oversized result could not be archived safely');
  }
  const result = ref && (!enriched || typeof enriched !== 'object')
    ? artifactPlaceholder(ref)
    : ref ? attachAgentArtifactRef(enriched, ref) : enriched;
  const success = !isFailedToolResult(result);
  const outcome: AgentToolOutcome = success
    ? { kind: 'success', artifactId: ref?.artifactId }
    : state.policy.recovery === 'outcome_unknown'
      ? { kind: 'outcome_unknown', operationId: state.operationId ?? state.toolCallId }
      : { kind: 'terminal_failure', code: 'tool_failed' };
  const digest = ref?.bodySha256 ?? await sha256Text(sanitized.body);
  throwIfToolAborted(execution.signal, state);
  await execution.runRecorder?.recordToolOutcome({
    toolCallId: state.toolCallId, toolName: schema.name, argsDigest: state.argsDigest,
    operationId: state.operationId, outcome, resultDigest: digest,
    artifactId: ref?.artifactId,
  }).catch(() => undefined);
  throwIfToolAborted(execution.signal, state);
  const followup = toolFollowupText(rawResult);
  if (success && typeof followup === 'string') execution.onFollowup?.(followup);
  execution.onEvent({ type: 'tool', name: schema.name, args, result });
  if (success && typeof followup === 'string') {
    return { success: true, result, followupText: followup };
  }
  return { success, result };
}
async function settleToolError(
  schema: AgentToolSchema,
  args: Record<string, unknown>,
  execution: LocalToolExecutionContext,
  state: ToolBoundaryState,
  error: unknown,
): Promise<ToolExecution> {
  const message = error instanceof Error ? error.message : String(error);
  const safeMessage = message.trim().slice(0, 1_000) || 'Tool execution failed.';
  const outcome = error instanceof ToolBoundaryError
    ? error.outcome
    : state.started && state.policy.recovery === 'outcome_unknown'
      ? { kind: 'outcome_unknown' as const, operationId: state.operationId ?? state.toolCallId }
      : { kind: 'terminal_failure' as const, code: 'execution_failed', summary: safeMessage };
  await execution.runRecorder?.recordToolOutcome({
    toolCallId: state.toolCallId, toolName: schema.name, argsDigest: state.argsDigest,
    operationId: state.operationId, outcome,
  }).catch(() => undefined);
  const failed = { error: safeMessage, ...(outcome.kind === 'outcome_unknown' ? { outcome: 'outcome_unknown' } : {}) };
  execution.onEvent({ type: 'tool', name: schema.name, args, result: failed });
  return { success: false, result: failed };
}
export async function executeOpenChatCutTool(
  schema: AgentToolSchema,
  args: Record<string, unknown>,
  execution: LocalToolExecutionContext,
): Promise<ToolExecution> {
  const state: ToolBoundaryState = {
    toolCallId: execution.toolCallId ?? crypto.randomUUID(),
    invocationArgs: args,
    policy: policyForTool(schema.name, args),
    started: false,
  };
  try {
    await prepareToolBoundary(schema, args, execution, state);
    throwIfToolAborted(execution.signal, state);
    await execution.runRecorder?.recordToolStarted({
      toolCallId: state.toolCallId, toolName: schema.name,
      argsDigest: state.argsDigest!, operationId: state.operationId,
    });
    throwIfToolAborted(execution.signal, state);
    state.before = snapshotTimeline(execution.ctx.getState());
    state.started = true;
    const result = await (execution.executeTool ?? executeEditorTool)(
      schema.name, state.invocationArgs, execution.ctx, execution.toolCatalog, execution.harness,
    );
    throwIfToolAborted(execution.signal, state);
    return await settleToolResult(schema, state.invocationArgs, result, execution, state);
  } catch (error) {
    return settleToolError(schema, state.invocationArgs, execution, state, error);
  }
}
