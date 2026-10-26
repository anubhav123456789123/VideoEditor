// One-click Claude Code connect: the ~/.claude.json merge is idempotent and never
// clobbers existing servers or unrelated settings; broken JSON is refused without
// touching the file; unknown clients and malformed tokens are rejected. Runs
// entirely inside a temp HOME.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectExternalClient } from './client-connect';

const ENDPOINT = 'http://localhost:5199/api/external-mcp/mcp';
const TOKEN = 'tok_AbC123-_xyz';

async function main(): Promise<void> {
  const home = await mkdtemp(path.join(tmpdir(), 'occ-connect-'));
  const file = path.join(home, '.claude.json');
  try {
    // 1. Creates ~/.claude.json with a user-scope http entry.
    const claude = await connectExternalClient('claude', ENDPOINT, TOKEN, { baseDir: home });
    assert.equal(claude.ok, true);
    if (claude.ok) assert.deepEqual(claude.paths, ['~/.claude.json']);
    const config = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(config.mcpServers.openchatcut.type, 'http');
    assert.equal(config.mcpServers.openchatcut.url, ENDPOINT);
    assert.equal(config.mcpServers.openchatcut.headers.Authorization, `Bearer ${TOKEN}`);

    // 2. Idempotent reconnect preserves other servers and unrelated settings.
    await writeFile(file, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'other' } } }, null, 2));
    const again = await connectExternalClient('claude', ENDPOINT, TOKEN, { baseDir: home });
    assert.equal(again.ok, true);
    const merged = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(merged.theme, 'dark', 'unrelated settings preserved');
    assert.equal(merged.mcpServers.other.command, 'other', 'existing server preserved');
    assert.equal(merged.mcpServers.openchatcut.url, ENDPOINT, 'openchatcut rewritten');

    // 3. Invalid JSON is refused without touching the file.
    await writeFile(file, '{broken');
    const broken = await connectExternalClient('claude', ENDPOINT, TOKEN, { baseDir: home });
    assert.equal(broken.ok, false);
    if (!broken.ok) assert.equal(broken.error, 'config-parse-error');
    assert.equal(await readFile(file, 'utf8'), '{broken');

    // 4. A non-object mcpServers is refused rather than overwritten.
    await writeFile(file, JSON.stringify({ mcpServers: ['x'] }));
    const shape = await connectExternalClient('claude', ENDPOINT, TOKEN, { baseDir: home });
    assert.equal(shape.ok, false);
    if (!shape.ok) assert.equal(shape.error, 'config-parse-error');

    // 5. Only Claude Code is a connect target; tokens and endpoints are validated.
    for (const client of ['cursor', 'codex', 'antigravity', 'nope']) {
      const result = await connectExternalClient(client, ENDPOINT, TOKEN, { baseDir: home });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, 'invalid-client', `${client} is not a connect target`);
    }
    for (const [endpoint, token] of [[ENDPOINT, 'bad token'], [ENDPOINT, 'tok"; rm -rf'], ['ftp://x', TOKEN]]) {
      const result = await connectExternalClient('claude', endpoint, token, { baseDir: home });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, 'invalid-token');
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
  console.log('client-connect.verify: ok');
}

await main();
