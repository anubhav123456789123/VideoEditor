import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { NextConfig } from 'next';

const require = createRequire(import.meta.url);
const appPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: unknown };
if (typeof appPackage.version !== 'string') throw new Error('package.json is missing a valid version');

// Startup snapshot of which key-gated capabilities are configured, injected for
// the agent's system prompt (src/agent/capabilities.ts). BOOLEANS ONLY — no key
// value ever reaches the browser. The host (server/next-host.ts) has already
// loaded .env files into process.env before Next evaluates this config.
const env = process.env;
const has = (...names: string[]) => names.some((name) => Boolean(env[name]));
const configuredCaps = {
  image: has('IMAGE_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'MINIMAX_API_KEY', 'FAL_KEY'),
  voice: has('DOUBAO_TTS_API_KEY', 'ELEVENLABS_API_KEY', 'MINIMAX_API_KEY'),
  video: has('SEEDANCE_API_KEY', 'KLING_API_KEY', 'MINIMAX_API_KEY', 'FAL_KEY'),
  music: has('MUREKA_API_KEY', 'MINIMAX_API_KEY'),
  sound: has('ELEVENLABS_API_KEY'),
  stock: has('PEXELS_API_KEY', 'PIXABAY_API_KEY', 'UNSPLASH_ACCESS_KEY', 'FREESOUND_API_KEY'),
  transcription: has('ASSEMBLYAI_API_KEY'),
  sandbox: has('E2B_API_KEY'),
  web: has('FIRECRAWL_API_KEY'),
};

const nextConfig: NextConfig = {
  // The editor is a client-only SPA mounted by app/page.tsx; API routes are
  // served by the plugin chain in server/next-host.ts ahead of Next.
  devIndicators: false,
  poweredByHeader: false,
  // Image imports are URL strings (Vite semantics, see turbopack.rules), not
  // StaticImageData; this also drops Next's conflicting `*.png` declarations.
  images: { disableStaticImages: true },
  experimental: {
    // Production export-name mangling renames a text module's `default` export
    // while import.meta.glob(..., { import: 'default' }) consumers still read
    // `.default` (agent skills came out undefined). Keep export names stable.
    turbopackMangleExportNames: false,
  },
  typescript: { tsconfigPath: 'tsconfig.next.json' },
  compiler: {
    define: {
      __APP_VERSION__: JSON.stringify(appPackage.version),
      __CONFIGURED_CAPS__: JSON.stringify(configuredCaps),
    },
  },
  turbopack: {
    // Vite's default resolve order: the source has same-stem .ts/.tsx pairs
    // (e.g. editor/transitionPreview) whose extensionless imports mean the .ts.
    resolveExtensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    rules: {
      // Vite query imports used across src/: `?raw` → string, `?url` → emitted URL.
      '*': [
        { condition: { query: /[?&]raw(?=&|$)/ }, type: 'text' },
        { condition: { query: /[?&]url(?=&|$)/ }, type: 'asset' },
      ],
      // Bare image imports resolve to a URL string (Vite semantics), not
      // Next's StaticImageData object — the source uses them as <img src>.
      '*.{png,jpg,jpeg,gif,webp,avif,svg,ico}': {
        condition: { all: [{ not: 'foreign' }, { query: '' }] },
        type: 'asset',
      },
      // TypeScript-ESM `./x.js` → `./x.ts` specifiers (see the loader's header).
      '*.{ts,tsx,mts}': {
        condition: { not: 'foreign' },
        loaders: [require.resolve('./config/turbopack/ts-extension-loader.cjs')],
      },
    },
  },
};

export default nextConfig;
