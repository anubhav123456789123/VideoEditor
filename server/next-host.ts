// Next.js host: one HTTP server serving the full OpenChatCut stack.
// The server plugins (server/plugins/index.ts) are mounted unchanged through the
// same mini-connect stub the Electron embedded server uses, so every API route,
// SSE stream and media endpoint behaves exactly as it did under Vite. Anything
// the plugins pass on (next()) is handed to Next.js, which serves the app shell
// (app/) and the editor bundle compiled by Turbopack.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
// The package entry (same module as 'next'), imported by path so Next's global
// type augmentation does not leak into the server/CLI type program.
import next from 'next/dist/server/next.js';
import type { ViteDevServer } from 'vite';
import nextEnv from '@next/env';
import { serverPlugins } from './plugins/index.ts';
import { seedKeystore } from './keystore.ts';
import { productAssetsPlugin } from './product-assets.ts';
import { runtimeProfile } from './runtime-profile.ts';
import { applyAuthoritativeLocalProvider } from '../shared/local-provider-env.ts';
import { createMiniConnect } from '../desktop/mini-connect.ts';
import { mountAssemblyAiProxy } from '../desktop/embedded-server.ts';
import { uploadsMiddleware } from '../desktop/static-files.ts';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT) || 5199;
const hostname = process.env.HOST || '127.0.0.1';

// Same env resolution as config/vite.config.ts: isolated profiles take only the
// wrapper-merged process env; the default checkout loads .env files and keeps an
// explicit .env.local provider authoritative over unrelated host-shell values.
function resolveEnv(): Record<string, string> {
  const profile = runtimeProfile();
  const processEnv = () => Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  if (profile.mode === 'isolated-dev' && existsSync(profile.keystorePath)) return processEnv();
  nextEnv.loadEnvConfig(process.cwd(), dev);
  const env = processEnv();
  if (profile.mode !== 'isolated-dev' && existsSync('.env.local')) {
    applyAuthoritativeLocalProvider(env, readFileSync('.env.local', 'utf8'));
  }
  if (profile.mode === 'isolated-dev') {
    process.stdout.write(`[OpenChatCut] isolated profile ${profile.id} · ${profile.rootDir}\n`);
  }
  return env;
}

async function main(): Promise<void> {
  seedKeystore(resolveEnv());

  const app = createMiniConnect((err) => {
    console.error('[next-host]', err instanceof Error ? err.message : err);
  });
  const server = createServer((req, res) => app.handle(req, res));
  const nextApp = next({ dev, hostname, port, httpServer: server, turbopack: true });
  const handle = nextApp.getRequestHandler();

  mountAssemblyAiProxy(app);

  // The plugins' only host dependencies: middlewares.use, httpServer, config.logger.
  const host = {
    middlewares: { use: app.use.bind(app) },
    httpServer: server,
    config: {
      logger: {
        info: (msg: string) => console.log(msg),
        warn: (msg: string) => console.warn(msg),
        error: (msg: string) => console.error(msg),
      },
    },
  } as unknown as ViteDevServer;
  for (const plugin of [...serverPlugins({ projectStoreHttp: true }), productAssetsPlugin()]) {
    const hook = plugin.configureServer;
    const fn = typeof hook === 'function' ? hook : hook?.handler;
    await fn?.call(plugin as never, host);
  }
  app.use('/media/uploads', uploadsMiddleware());

  await nextApp.prepare();
  // Everything the plugins did not answer goes to Next with its original URL.
  app.use((req, res) => {
    const original = (req as { originalUrl?: string }).originalUrl;
    if (original) req.url = original;
    void handle(req, res);
  });
  // Next's dev server needs WebSocket upgrades for HMR.
  const upgrade = nextApp.getUpgradeHandler();
  server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head); });

  server.listen(port, hostname, () => {
    console.log(`> OpenChatCut ready on http://${hostname}:${port} (${dev ? 'development' : 'production'})`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
