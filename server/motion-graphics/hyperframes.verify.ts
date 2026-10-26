// HyperFrames helpers: script localization, duration parsing, and the linter
// accepting the bundled compositions while flagging broken ones.
//   npx tsx server/motion-graphics/hyperframes.verify.ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compositionSeconds, lintComposition, localizeScripts } from './hyperframes.ts';
import { resolveLocalAsset, scanLocalAssets } from '../local-assets.ts';

assert.equal(
  localizeScripts('<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script><script src="https://evil.test/x.js"></script><script>inline()</script>'),
  '<script src="gsap.min.js"></script><script>inline()</script>',
  'GSAP is pointed at the local copy, other external scripts are dropped, inline scripts stay',
);

assert.equal(compositionSeconds('tl.set({}, {}, 4); tl.set({},{},6.5);'), 6.5, 'longest timeline extension wins');
assert.equal(compositionSeconds('tl.set({}, {}, 600);'), 60, 'clamped to the render cap');
assert.equal(compositionSeconds('no timeline'), null);

const bundled = scanLocalAssets('motion-graphics').filter((entry) => entry.engine === 'hyperframes');
assert.ok(bundled.length >= 2, 'bundled HyperFrames compositions exist');
for (const entry of bundled) {
  const html = await readFile(resolveLocalAsset(entry.id)!, 'utf8');
  assert.deepEqual(await lintComposition(html), [], `${entry.id} passes the HyperFrames linter`);
  assert.ok((compositionSeconds(html) ?? 0) > 0, `${entry.id} declares its duration`);
}

const broken = await lintComposition('<html><body><div>no composition</div></body></html>');
assert.ok(broken.includes('missing data-composition-id'), 'missing composition id is reported');
assert.ok(broken.some((p) => p.includes('__timelines')), 'unregistered timeline is reported');

console.log('hyperframes.verify: ok');
