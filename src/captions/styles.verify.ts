import assert from 'node:assert/strict';
import { CAPTION_STYLES, CAPTION_STYLE_BY_ID } from './styles';
import { paginate } from './types';
import { findFontshareFont } from '../fonts/fontshareFonts';
import { isLoadableFontFamily } from '../fonts/googleFontCatalog';

assert.equal(CAPTION_STYLES.length, 29);
assert.equal(new Set(CAPTION_STYLES.map((style) => style.id)).size, 29);
assert.equal(CAPTION_STYLE_BY_ID['the-french-dispatch'].label, 'The French Dispatch');
// 黑底白字默认样式:整句连续渲染(无词间隙/无逐词高亮)+整行黑底
assert.equal(CAPTION_STYLE_BY_ID['black-bar'].wholeLine, true);
assert.ok(CAPTION_STYLE_BY_ID['black-bar'].background);
assert.equal(paginate([
  { text: 'one', start: 0, end: 100 },
  { text: 'two', start: 110, end: 200 },
  { text: 'three', start: 210, end: 300 },
], 'phrase', 2).length, 2);

// Fontshare presets resolve to loadable catalog families (loaded at runtime, never bundled).
for (const id of ['satoshi-clean', 'clash-hype', 'general-pill', 'cabinet-karaoke', 'boska-editorial', 'tanker-impact', 'switzer-glass'] as const) {
  const family = CAPTION_STYLE_BY_ID[id].fontFamily;
  assert.ok(findFontshareFont(family), `${id} uses a Fontshare family (${family})`);
  assert.ok(isLoadableFontFamily(family), `${family} is in the font catalog`);
}

console.log('caption-styles.check: ok');
