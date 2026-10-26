// One-shot Claude calls for the Motion Graphics tab. Uses the official
// Anthropic SDK with the Claude API key saved in Settings; when only a Claude
// Code subscription is connected, falls back to a non-interactive `claude -p`
// run with tools disabled.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { getKey, type KeyName } from '../keystore.ts';
import { resolveLlmProviderConfig } from '../llm-config.ts';
import { claudeCodeCommand } from '../claude-code/command.ts';
import { resolveClaudeCodeCli } from '../claude-code/installation.ts';
import { childEnvironment } from '../claude-code/turn-runner.ts';

const MAX_OUTPUT_TOKENS = 32_000;
const CLI_TIMEOUT_MS = 10 * 60_000;

export class ClaudeUnavailableError extends Error {
  constructor() {
    super('Claude is not connected. Add a Claude API key or sign in to Claude Code in Settings.');
    this.name = 'ClaudeUnavailableError';
  }
}

export interface ClaudeTextRequest {
  system: string;
  prompt: string;
  signal?: AbortSignal;
}

/** The SDK appends /v1/messages itself; the saved Base URL is the /v1 prefix. */
export function sdkBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

async function viaApi(request: ClaudeTextRequest, apiKey: string, baseUrl: string, model: string): Promise<string> {
  const client = new Anthropic({ apiKey, baseURL: sdkBaseUrl(baseUrl) });
  const message = await client.messages.stream({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: request.system,
    messages: [{ role: 'user', content: request.prompt }],
  }, { signal: request.signal }).finalMessage();
  if (message.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  if (message.stop_reason === 'max_tokens') throw new Error('The generated motion graphic was too long; try a simpler prompt.');
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
}

async function viaClaudeCode(request: ClaudeTextRequest, cli: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openchatcut-mg-'));
  try {
    const systemPath = join(dir, 'system.md');
    await writeFile(systemPath, request.system, 'utf8');
    const args = [
      '-p', request.prompt,
      '--output-format', 'json',
      '--append-system-prompt-file', systemPath,
      '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch',
    ];
    const model = getKey('CLAUDE_CODE_MODEL');
    if (model) args.push('--model', model);
    const command = claudeCodeCommand(cli, args);
    const child = spawn(command.executable, command.args, {
      cwd: dir,
      env: childEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments: command.windowsVerbatimArguments,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
    const timer = setTimeout(() => child.kill('SIGKILL'), CLI_TIMEOUT_MS);
    const abort = () => child.kill('SIGKILL');
    request.signal?.addEventListener('abort', abort, { once: true });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    }).finally(() => {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
    });
    if (code !== 0) throw new Error(`Claude Code exited ${code ?? 'unexpectedly'}: ${stderr.trim().slice(-400)}`);
    const parsed = JSON.parse(stdout) as { result?: unknown; is_error?: unknown };
    if (parsed.is_error === true || typeof parsed.result !== 'string') {
      throw new Error(`Claude Code failed: ${String(parsed.result ?? 'no result').slice(0, 400)}`);
    }
    return parsed.result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Ask Claude for text: Claude API key first, then the Claude Code CLI. */
export async function generateClaudeText(request: ClaudeTextRequest): Promise<string> {
  const config = resolveLlmProviderConfig('anthropic', (name) => getKey(name as KeyName));
  if (config.apiKey) return viaApi(request, config.apiKey, config.baseUrl, config.model);
  const cli = await resolveClaudeCodeCli();
  if (cli) return viaClaudeCode(request, cli);
  throw new ClaudeUnavailableError();
}
