import { startUiLocaleSync } from '../i18n/localeSync';
import { t } from '../i18n/locale';
import { useCallback, useEffect, useState } from 'react';
import { applyLiveCaps, applyLiveKeyStatus, applyLiveModels } from '../agent/capabilities';
import { fetchClaudeCodeModels, fetchClaudeCodeStatus } from '../agent/claude-code/client';
import { applyAgentModelStatus, applyClaudeCodeAgentStatus } from '../agent/model-selection';
import type { ProjectDoc, TimelineState } from '../editor/types';
import {
  createProject,
  docFromTimeline,
  hasProjectHistory,
  listProjects,
} from '../persist/projectStore';
import type { ProjectMeta } from '../persist/projectStoreCoordinators';
import { kvRemoteMode } from '../persist/sharedKv';
import { projectStoreWriteCredential } from '../persist/projectStoreTransport';

export type AppRoute = { name: 'dashboard' } | { name: 'editor'; id: string };

interface LiveAgentStatus {
  readonly caps?: Record<string, boolean>;
  readonly keys?: Record<string, { readonly configured: boolean }>;
  readonly models?: Record<string, string>;
}

const emptyState = (): TimelineState => ({
  fps: 30,
  width: 1920,
  height: 1080,
  items: [],
  selectedId: null,
  trackOrder: ['track_v1'],
  tracks: { track_v1: { kind: 'video' } },
});

export const emptyProjectDoc = (): ProjectDoc => docFromTimeline(emptyState());
// Keep the sample timeline out of established users' startup bundle; it is needed only on first run.
const seedDoc = async (): Promise<ProjectDoc> => docFromTimeline((await import('../editor/initial')).INITIAL);

function parseHash(): AppRoute {
  const match = window.location.hash.match(/^#\/editor\/(.+)$/);
  return match ? { name: 'editor', id: match[1] } : { name: 'dashboard' };
}

export function navigateTo(hash: string): void {
  window.location.hash = hash;
}

/**
 * Claude Code is a first-class CLI backend, so its status has to be
 * discovered on app launch rather than the first time Settings mounts: the
 * model picker builds its Anthropic entries from this status, and before this
 * ran at startup the backend stayed invisible until the user opened Settings
 * and re-detected the CLI by hand.
 */
async function syncClaudeCodeBackend(isActive: () => boolean, savedModel?: string): Promise<void> {
  try {
    const status = await fetchClaudeCodeStatus();
    if (!isActive()) return;
    const models = status.installed && status.account?.loggedIn === true
      ? await fetchClaudeCodeModels().catch(() => null)
      : null;
    if (isActive()) {
      applyClaudeCodeAgentStatus(status, savedModel, models && !models.error ? models.models : []);
    }
  } catch {
    // An optional backend must not prevent the configured Claude API model from loading.
  }
}

export async function syncAgentBackends(isActive: () => boolean): Promise<void> {
  const keyResult = await fetch('/api/keys')
    .then(async (response): Promise<LiveAgentStatus> => {
      if (!response.ok) throw new Error('Agent key status is unavailable.');
      return response.json() as Promise<LiveAgentStatus>;
    })
    .then((value) => ({ status: 'fulfilled' as const, value }), () => ({ status: 'rejected' as const }));
  if (!isActive()) return;
  let savedClaudeCodeModel: string | undefined;
  if (keyResult.status === 'fulfilled') {
    const { caps, keys, models } = keyResult.value;
    if (caps) applyLiveCaps(caps);
    if (keys) applyLiveKeyStatus(keys);
    if (models) {
      applyLiveModels(models);
      applyAgentModelStatus(keys ?? {}, models);
      savedClaudeCodeModel = models.CLAUDE_CODE_MODEL;
    }
    startUiLocaleSync(models?.UI_LOCALE);
  }
  // Detached: `claude --version` plus `claude auth status` can take seconds,
  // and the configured Claude API model must stay usable while it runs.
  void syncClaudeCodeBackend(isActive, savedClaudeCodeModel);
}

export function useAppRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(parseHash());
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export function useAgentBackendSync(): void {
  useEffect(() => {
    let alive = true;
    void syncAgentBackends(() => alive);
    return () => { alive = false; };
  }, []);
}

export interface ProjectStartupSource {
  list(): Promise<ProjectMeta[]>;
  hasHistory(): Promise<boolean>;
  canSeedDemo(): boolean;
  createDemo(): Promise<ProjectMeta>;
}

const projectStartupSource: ProjectStartupSource = {
  list: listProjects,
  hasHistory: hasProjectHistory,
  canSeedDemo: () => kvRemoteMode() === 'local' || projectStoreWriteCredential(),
  createDemo: async () => createProject(t('示例工程'), await seedDoc()),
};

export async function loadInitialProjects(
  source: ProjectStartupSource = projectStartupSource,
): Promise<ProjectMeta[]> {
  const list = await source.list();
  if (list.length > 0 || await source.hasHistory()) return list;
  if (!source.canSeedDemo()) return [];
  return [await source.createDemo()];
}

export function useProjects(): {
  projects: ProjectMeta[] | null;
  refresh: () => Promise<void>;
} {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const refresh = useCallback(async () => { setProjects(await listProjects()); }, []);
  useEffect(() => {
    void loadInitialProjects().then(setProjects);
  }, []);
  return { projects, refresh };
}
