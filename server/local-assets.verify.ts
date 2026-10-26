// Local asset library scanning: kinds, categories, sidecars, extension filtering,
// path-traversal rejection, generated-MG naming, and the bundled starter files.
//   npx tsx server/local-assets.verify.ts
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOCAL_ASSET_KINDS,
  resolveLocalAsset,
  saveMotionGraphic,
  scanLocalAssetLibrary,
  scanLocalAssets,
} from './local-assets.ts';
import { validateTransitionShaderSource } from '../src/agent/tools/shader-tools.ts';

const root = await mkdtemp(join(tmpdir(), 'openchatcut-local-assets-'));
try {
  await mkdir(join(root, 'sfx', 'whoosh'), { recursive: true });
  await mkdir(join(root, 'music'), { recursive: true });
  await mkdir(join(root, 'transitions'), { recursive: true });
  await mkdir(join(root, 'motion-graphics', 'deep', 'deeper'), { recursive: true });
  await writeFile(join(root, 'sfx', 'whoosh', 'air_swish.mp3'), 'x');
  await writeFile(join(root, 'sfx', 'click.wav'), 'x');
  await writeFile(join(root, 'sfx', 'notes.txt'), 'ignored');
  await writeFile(join(root, 'sfx', '.hidden.mp3'), 'ignored');
  await writeFile(join(root, 'music', 'bed one.mp3'), 'x');
  await writeFile(join(root, 'music', 'bed one.json'), JSON.stringify({ name: 'Morning Bed', seconds: 12 }));
  await writeFile(join(root, 'transitions', 'wipe.glsl'), 'void main(){}');
  await writeFile(join(root, 'transitions', 'wipe.json'), '{ broken json');
  await writeFile(join(root, 'motion-graphics', 'title.jsx'), 'const T = () => null;');
  await writeFile(join(root, 'motion-graphics', 'badge.html'), '<html></html>');
  await writeFile(join(root, 'motion-graphics', 'deep', 'deeper', 'too-deep.jsx'), 'x');

  const library = scanLocalAssetLibrary(root);
  assert.deepEqual(Object.keys(library).sort(), [...LOCAL_ASSET_KINDS].sort());

  const sfx = library.sfx;
  assert.deepEqual(sfx.map((e) => e.id), ['sfx/click.wav', 'sfx/whoosh/air_swish.mp3'], 'audio only, hidden and non-audio files skipped');
  assert.equal(sfx[0]!.category, '', 'files directly in the folder have no category');
  assert.equal(sfx[1]!.category, 'whoosh', 'first sub-folder is the category');
  assert.equal(sfx[1]!.name, 'Air swish', 'display name from the file name');
  assert.equal(sfx[1]!.url, '/sfx/whoosh/air_swish.mp3', 'served root-relative');

  assert.equal(library.music[0]!.name, 'Morning Bed', 'sidecar name wins');
  assert.equal(library.music[0]!.meta.seconds, 12, 'sidecar metadata is passed through');
  assert.equal(library.music[0]!.url, '/music/bed%20one.mp3', 'URL segments are encoded');
  assert.deepEqual(library.transitions[0]!.meta, {}, 'broken sidecar JSON is ignored');

  const mg = scanLocalAssets('motion-graphics', root);
  assert.deepEqual(mg.map((e) => [e.id, e.engine]), [
    ['motion-graphics/badge.html', 'hyperframes'],
    ['motion-graphics/title.jsx', 'remotion'],
  ], 'engine from extension; deeper than one sub-folder is not scanned');

  assert.ok(resolveLocalAsset('motion-graphics/badge.html', root));
  for (const bad of ['motion-graphics/../sfx/click.wav', 'sfx/../../etc/passwd', 'secrets/x.jsx', 'motion-graphics/notes.txt', 'motion-graphics', 'sfx/a/b/c.mp3', 'sfx/..\\x.mp3']) {
    assert.equal(resolveLocalAsset(bad, root), null, `rejects ${bad}`);
  }

  const first = await saveMotionGraphic({ name: 'Big Title!', engine: 'remotion', source: 'const A = () => null;', meta: { durationInFrames: 90 } }, root);
  const second = await saveMotionGraphic({ name: 'Big Title!', engine: 'hyperframes', source: '<html></html>', meta: {} }, root);
  const third = await saveMotionGraphic({ name: 'Big Title!', engine: 'remotion', source: 'x', meta: {} }, root);
  assert.equal(first, 'motion-graphics/generated/big-title.jsx');
  assert.equal(second, 'motion-graphics/generated/big-title.html');
  assert.equal(third, 'motion-graphics/generated/big-title-2.jsx', 'never overwrites an earlier graphic');
  const sidecar = JSON.parse(await readFile(join(root, 'motion-graphics', 'generated', 'big-title.json'), 'utf8'));
  assert.equal(sidecar.name, 'Big Title!');
  assert.equal(scanLocalAssets('motion-graphics', root).find((e) => e.id === first)?.category, 'generated');
} finally {
  await rm(root, { recursive: true, force: true });
}

// The bundled starter library: every kind has content and every shader meets the transition contract.
const bundled = scanLocalAssetLibrary();
for (const kind of LOCAL_ASSET_KINDS) assert.ok(bundled[kind].length > 0, `bundled ${kind} folder has starter content`);
for (const entry of bundled.transitions) {
  const file = resolveLocalAsset(entry.id);
  assert.ok(file, entry.id);
  assert.equal(validateTransitionShaderSource(await readFile(file, 'utf8')), null, `${entry.id} meets the transition shader contract`);
}

console.log('local-assets.verify: ok');
