// Fontshare catalog: lookup by family or slug, weight snapping, CSS API URLs,
// catalog integration, and the node-safe no-op outside a browser.
//   npx tsx src/fonts/fontshareFonts.verify.ts
import assert from 'node:assert/strict';
import { FONTSHARE_FONTS, ensureFontshareFont, findFontshareFont, fontshareCssUrl, nearestFontshareWeight } from './fontshareFonts';
import { FONT_CATALOG, isLoadableFontFamily, resolveCanonicalFamily, searchFontCatalog } from './googleFontCatalog';

assert.equal(new Set(FONTSHARE_FONTS.map((f) => f.slug)).size, FONTSHARE_FONTS.length, 'slugs are unique');
for (const font of FONTSHARE_FONTS) {
  assert.match(font.slug, /^[a-z]+(?:-[a-z]+)*$/, `${font.family}: API slug shape`);
  assert.ok(font.weights.length > 0 && font.weights.every((w, i, a) => i === 0 || a[i - 1]! < w), `${font.family}: ascending weights`);
}

assert.equal(findFontshareFont('Satoshi')?.slug, 'satoshi');
assert.equal(findFontshareFont('general sans')?.family, 'General Sans', 'case and spacing insensitive');
assert.equal(findFontshareFont('clash-display')?.family, 'Clash Display', 'slug lookup');
assert.equal(findFontshareFont('Inter'), undefined, 'Google fonts are not Fontshare fonts');

const tanker = findFontshareFont('Tanker')!;
assert.equal(nearestFontshareWeight(tanker, 900), 400, 'single-weight families snap to their only weight');
assert.equal(nearestFontshareWeight(findFontshareFont('Satoshi')!, 600), 500, 'nearest shipped weight (ties go to the lighter)');
assert.equal(
  fontshareCssUrl(findFontshareFont('Satoshi')!),
  'https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700,900&display=swap',
);

const catalog = FONT_CATALOG.filter((entry) => entry.source === 'fontshare');
assert.equal(catalog.length, FONTSHARE_FONTS.length, 'every Fontshare family is in the font catalog');
assert.equal(resolveCanonicalFamily('"Clash Display", sans-serif'), 'Clash Display');
assert.equal(resolveCanonicalFamily('cabinet-grotesk'), 'Cabinet Grotesk', 'slug alias resolves');
assert.ok(isLoadableFontFamily('Boska'));
assert.ok(searchFontCatalog('satoshi').some((hit) => hit.family === 'Satoshi' && hit.source === 'fontshare'));

await ensureFontshareFont('Satoshi', 700); // no document under tsx: resolves without touching the network
console.log('fontshareFonts.verify: ok');
