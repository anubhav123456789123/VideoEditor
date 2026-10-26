'use client';

import { useEffect } from 'react';

export function EditorMount() {
  useEffect(() => {
    // src/main.tsx is the original entry: locale, skins, fonts, plugins, then
    // createRoot(#root). Importing it once is enough; the module cache dedupes.
    void import('../src/main');
  }, []);
  return <div id="root" />;
}
