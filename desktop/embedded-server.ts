// Electron embedded production server: a 127.0.0.1 HTTP server provides the same full stack as dev —
// ① seedKeystore(.env.local, cwd semantics are consistent with dev; the packaged version is main first chdir userData)
// ② /llm is mounted by the shared server plugin (Claude only)
// ③ Zero modification and mounting of server plugin (the measured dependency is only middlewares.use + config.logger)
// ④ /media/uploads Direct reading of assets at runtime + dist/ static cover (desktop/static-files.ts)
// The key still only lives in this process; the rendering process (BrowserWindow) only sees the same-origin HTTP API.
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import type { ViteDevServer } from 'vite';
import { serverPlugins } from '../server/plugins/index.ts';
import { seedKeystore } from '../server/keystore.ts';
import { parseEnvText } from './env-file.ts';
import { createMiniConnect } from './mini-connect.ts';
import { listenWithAffinity } from './embedded-port.ts';
import { runtimeProfile } from '../server/runtime-profile.ts';
import { distStaticMiddleware, uploadsMiddleware } from './static-files.ts';
import { registerProductAssetRoot } from '../server/product-assets.ts';

export interface EmbeddedServer {
  server: Server;
  port: number;
  origin: string;
}

async function seedFromEnvLocal(): Promise<void> {
  const text = await readFile(resolve(process.cwd(), '.env.local'), 'utf8').catch(() => '');
  seedKeystore(parseEnvText(text));
}

export async function startEmbeddedServer(distDir: string): Promise<EmbeddedServer> {
  // Product files (fonts, voice samples, LUTs, …) live in resources/dist when packaged.
  registerProductAssetRoot(distDir);
  await seedFromEnvLocal();

  const app = createMiniConnect((err) => {
    console.error('[embedded-server]', err instanceof Error ? err.message : err);
  });
  const server = createServer((req, res) => app.handle(req, res));

  // vite server pile: complete set of plugin dependencies = middlewares.use + config.logger (verified by plugin)
  const fake = {
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
  for (const plugin of serverPlugins({ projectStoreHttp: true })) {
    const hook = plugin.configureServer;
    const fn = typeof hook === 'function' ? hook : hook?.handler;
    await fn?.call(plugin as never, fake);
  }

  // Static cover at the end: uploading assets at runtime takes precedence over dist's build-stage copy
  app.use('/media/uploads', uploadsMiddleware());
  app.use(distStaticMiddleware(distDir));

  // Port policy: canonical 5199 first (the documented external-MCP address),
  // then the fallback used last time it was busy, then a fresh random port that
  // becomes the remembered one. See listenWithAffinity for why the fallback has
  // to be stable: a random port per launch silently broke registered agents.
  const profile = runtimeProfile();
  const port = await listenWithAffinity(
    server,
    profile.mode === 'isolated-dev' ? { profileId: profile.id } : {},
  );
  return { server, port, origin: `http://127.0.0.1:${port}` };
}
