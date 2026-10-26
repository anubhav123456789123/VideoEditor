// Motion Graphics tab Claude calls: the official SDK is pointed at the saved
// Claude Base URL (without the /v1 suffix it appends itself), sends the saved
// key and model, streams, and surfaces refusals. Uses a local mock of the
// Messages API; no network.
//   npx tsx server/motion-graphics/claude.verify.ts
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateClaudeText, sdkBaseUrl } from './claude.ts';
import { KEY_NAMES, seedKeystore } from '../keystore.ts';

assert.equal(sdkBaseUrl('https://api.anthropic.com/v1'), 'https://api.anthropic.com');
assert.equal(sdkBaseUrl('https://relay.test/api/v1/'), 'https://relay.test/api');
assert.equal(sdkBaseUrl('https://relay.test/custom'), 'https://relay.test/custom');

let stopReason = 'end_turn';
const seen: Array<{ url: string; key: string | undefined; body: Record<string, unknown> }> = [];
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  seen.push({ url: req.url ?? '', key: req.headers.authorization, body });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } });
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '```jsx\nconst A = () => ' } });
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'null;\n```' } });
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 9 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;

try {
  seedKeystore({
    ...Object.fromEntries(KEY_NAMES.map((name) => [name, ''])),
    LLM_ANTHROPIC_API_KEY: 'sk-ant-test',
    LLM_ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/v1`,
    LLM_ANTHROPIC_MODEL: 'claude-sonnet-5-5',
  } as Record<string, string>);
  const text = await generateClaudeText({ system: 'SYSTEM', prompt: 'a title card' });
  assert.equal(text, '```jsx\nconst A = () => null;\n```', 'streamed text is joined');
  assert.equal(seen[0]?.url, '/v1/messages', 'the SDK appends /v1/messages to the saved prefix once');
  assert.equal(seen[0]?.key, 'Bearer sk-ant-test', 'the saved key authenticates the request (SDK 1.x sends it as a Bearer credential)');
  assert.equal(seen[0]?.body.model, 'claude-sonnet-5-5', 'the saved model is used');
  assert.equal(seen[0]?.body.system, 'SYSTEM');
  assert.equal(seen[0]?.body.stream, true, 'requests stream');
  assert.equal('temperature' in (seen[0]?.body ?? {}), false, 'no sampling parameters are sent');

  stopReason = 'refusal';
  await assert.rejects(generateClaudeText({ system: 'S', prompt: 'p' }), /declined/);
  stopReason = 'max_tokens';
  await assert.rejects(generateClaudeText({ system: 'S', prompt: 'p' }), /too long/);
} finally {
  server.close();
}

console.log('motion-graphics claude.verify: ok');
