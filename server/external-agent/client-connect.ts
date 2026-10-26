// One-click Claude Code connection: writes the OpenChatCut MCP endpoint and
// token into Claude Code's config (~/.claude.json). Only the `openchatcut`
// entry is touched; every other server is preserved. The file is merged
// atomically (write-to-temp + rename) and never clobbered when the existing
// content fails to parse.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const CONNECT_CLIENTS = ['claude'] as const;
export type ConnectClient = (typeof CONNECT_CLIENTS)[number];

export type ClientConnectResult =
  | { ok: true; paths: string[] }
  | { ok: false; error: 'invalid-client' | 'invalid-token' | 'config-parse-error' | 'config-write-error'; detail?: string };

export interface ClientConnectOptions {
  /** Base directory that stands in for the user home. Defaults to os.homedir(). */
  baseDir?: string;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

function displayPath(baseDir: string, file: string): string {
  const rel = path.relative(baseDir, file);
  return rel.startsWith('..') ? file : `~/${rel.split(path.sep).join('/')}`;
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.occ-connect-tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

type MergeFailure = { ok: false; error: 'config-parse-error' | 'config-write-error'; detail?: string };

async function mergeJsonConfig(
  file: string,
  build: (root: Record<string, unknown>) => void,
): Promise<{ ok: true } | MergeFailure> {
  let root: Record<string, unknown> = {};
  try {
    const text = await readFile(file, 'utf8');
    if (text.trim()) {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'config-parse-error', detail: file };
      }
      root = parsed as Record<string, unknown>;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ok: false, error: 'config-parse-error', detail: file };
    }
  }
  const servers = root.mcpServers;
  if (servers !== undefined && (typeof servers !== 'object' || servers === null || Array.isArray(servers))) {
    return { ok: false, error: 'config-parse-error', detail: 'mcpServers' };
  }
  build(root);
  try {
    await writeAtomic(file, `${JSON.stringify(root, null, 2)}\n`);
  } catch (error) {
    return { ok: false, error: 'config-write-error', detail: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true };
}

function httpEntry(endpoint: string, token: string): Record<string, unknown> {
  return { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } };
}

export async function connectExternalClient(
  client: string,
  endpoint: string,
  token: string,
  options: ClientConnectOptions = {},
): Promise<ClientConnectResult> {
  if (!CONNECT_CLIENTS.includes(client as ConnectClient)) {
    return { ok: false, error: 'invalid-client' };
  }
  if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint) || !TOKEN_PATTERN.test(token)) {
    return { ok: false, error: 'invalid-token' };
  }
  const baseDir = options.baseDir ?? homedir();
  const file = path.join(baseDir, '.claude.json');
  const result = await mergeJsonConfig(file, (root) => {
    const servers = (root.mcpServers as Record<string, unknown> | undefined) ?? {};
    servers.openchatcut = httpEntry(endpoint, token);
    root.mcpServers = servers;
  });
  if (!result.ok) return result;
  return { ok: true, paths: [displayPath(baseDir, file)] };
}
