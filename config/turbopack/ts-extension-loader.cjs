// Turbopack loader: resolve TypeScript-ESM style specifiers the way Vite/tsc do.
// Source files import `./foo.js` for a sibling `./foo.ts` (or `.tsx`); Turbopack
// only resolves files that exist, so rewrite a relative `.js`/`.jsx` specifier to
// the TypeScript file when — and only when — the `.js` file itself is absent.
const { existsSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bexport\s*\*\s*from\s*)(['"])(\.{1,2}\/[^'"]+?)\.(js|jsx|mjs)\2/g;
const TS_FOR = { js: ['.ts', '.tsx'], jsx: ['.tsx'], mjs: ['.mts'] };

module.exports = function tsExtensionLoader(source) {
  const dir = dirname(this.resourcePath);
  return source.replace(SPECIFIER, (match, lead, quote, stem, ext) => {
    if (existsSync(resolve(dir, `${stem}.${ext}`))) return match;
    const ts = TS_FOR[ext].find((candidate) => existsSync(resolve(dir, stem + candidate)));
    return ts ? `${lead}${quote}${stem}${ts}${quote}` : match;
  });
};
