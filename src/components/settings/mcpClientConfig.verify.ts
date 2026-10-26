// Checks the Claude Code CLI registration command: HTTP transport, the endpoint
// as given, and the bearer token in a header rather than the URL.
import assert from 'node:assert/strict';
import { claudeMcpAddCommand } from './mcpClientConfig';

const ENDPOINT = 'http://localhost:5199/api/external-mcp/mcp';
const TOKEN = 'tok_CLAUDE123-_abc';

const command = claudeMcpAddCommand(ENDPOINT, TOKEN);
assert.ok(command.startsWith('claude mcp add --transport http openchatcut '), 'registers the openchatcut server over HTTP');
assert.ok(command.includes(` ${ENDPOINT} `), 'endpoint is passed verbatim');
assert.ok(command.includes(`--header "Authorization: Bearer ${TOKEN}"`), 'token travels in the Authorization header');
assert.ok(!command.includes(`${ENDPOINT}?`) && !/access_token|token=/.test(command), 'token is not smuggled into the URL');

console.log('✓ mcpClientConfig: Claude Code command carries bearer header auth');
