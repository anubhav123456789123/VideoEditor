// Server-side plugin assembly (single source of truth): native shared storage + key-gated connect middleware and respective keystores
// Getter configuration, extracted from config/vite.config.ts as is. The two hosts share the same assembly and ensure the same API:
// - config/vite.config.ts → dev server(vite mount)
// - desktop/embedded-server.ts → Electron production shell (stub mounting)
// Getter reads keystore immediately - the next request will take effect after the setting panel is saved, no need to restart.
import type { Plugin } from "vite";
import { crossOriginIsolationPlugin } from "./cross-origin-isolation.ts";
import { storageLifecyclePlugin } from './storage-lifecycle.ts';
import { projectStorePlugin } from "./project-store-plugin.ts";
import { extensionStorePlugin } from "./extension-store.ts";
import { exportPlugin } from "./export.ts";
import { exportQaPlugin } from "./export-qa.ts";
import { exportDestinationPlugin } from "./export-destination.ts";
import { uploadPostPlugin } from "./upload-post.ts";
import { exportMediaSourcesPlugin } from "./export-media-sources.ts";
import { exportStagePlugin } from "./export-stage.ts";
import { uploadPlugin } from "./upload.ts";
import { mobileUploadPlugin } from "./mobile-upload.ts";
import { uploadMultipartPlugin } from "./upload-multipart.ts";
import { extractAudioPlugin } from "./extract-audio.ts";
import { hfProxyPlugin } from "./hf-proxy.ts";
import { asrModelsPlugin } from "./asr-models.ts";
import { modelPacksPlugin } from "./model-packs.ts";
import { extractFramesPlugin } from "./extract-frames.ts";
import { sceneDetectionPlugin } from "./scene-detection.ts";
import { autoGradePlugin } from "./auto-grade.ts";
import { mediaPreviewPlugin } from "./media-preview.ts";
import { isolateVoicePlugin } from "./isolate-voice.ts";
import { normalizeMediaPlugin } from "./normalize-media.ts";
import { probeMediaPlugin } from "./probe-media.ts";
import { e2bPlugin } from "./e2b.ts";
import { subtitleExportPlugin } from "./subtitles.ts";
import { generationProgressPlugin } from "./generation-jobs.ts";
import { stockSearchPlugin } from "./stock.ts";
import { firecrawlPlugin } from "./firecrawl.ts";
import { settingsPlugin } from "./settings.ts";
import { skillFilesPlugin } from "./skill-files.ts";
import { skillInstallPlugin } from "./skill-install.ts";
import { skillExecPlugin } from "./skill-exec.ts";
import { externalAgentPlugin } from "./external-agent.ts";
import { claudeCodeAgentPlugin } from "./claude-code-agent.ts";
import { llmProxyPlugin } from "./llm-proxy.ts";
import { agentRunsPlugin } from "../agent-runs/routes.ts";
import { localMediaPlugin } from "./local-media.ts";
import { resourcePreviewPlugin } from "./resource-preview.ts";
import { getKey } from "../keystore.ts";

import { installSystemProxy } from '../net.ts';
import { requestShapeGatePlugin } from './request-shape-gate';
import { systemFontsPlugin } from './system-fonts.ts';

export function serverPlugins(options: { projectStoreHttp?: boolean } = {}): Plugin[] {
  installSystemProxy();
  return [
    requestShapeGatePlugin(),
    systemFontsPlugin(),
    crossOriginIsolationPlugin(),
    storageLifecyclePlugin(),
    llmProxyPlugin(),
    agentRunsPlugin(),
    localMediaPlugin(),
    skillFilesPlugin(),
    skillInstallPlugin(),
    skillExecPlugin(),
    resourcePreviewPlugin({
      get token() {
        return getKey("RESOURCE_PREVIEW_TOKEN");
      },
    }),
    projectStorePlugin({ http: options.projectStoreHttp }),
    extensionStorePlugin(),
    externalAgentPlugin(),
    claudeCodeAgentPlugin(),
    settingsPlugin(),
    exportStagePlugin(),
    exportPlugin(),
    exportDestinationPlugin(),
    uploadPostPlugin(),
    exportMediaSourcesPlugin(),
    exportQaPlugin(),
    uploadMultipartPlugin(),
    uploadPlugin(),
    mobileUploadPlugin(),
    extractAudioPlugin(),
    hfProxyPlugin(),
    asrModelsPlugin(),
    modelPacksPlugin(),
    extractFramesPlugin(),
    sceneDetectionPlugin(),
    autoGradePlugin(),
    mediaPreviewPlugin(),
    isolateVoicePlugin(),
    normalizeMediaPlugin(),
    probeMediaPlugin(),
    generationProgressPlugin(),
    subtitleExportPlugin(),
    stockSearchPlugin({
      get pexelsApiKey() {
        return getKey("PEXELS_API_KEY");
      },
      get pixabayApiKey() {
        return getKey("PIXABAY_API_KEY");
      },
      get unsplashAccessKey() {
        return getKey("UNSPLASH_ACCESS_KEY");
      },
      get freesoundApiKey() {
        return getKey("FREESOUND_API_KEY");
      },
      get firecrawlApiKey() {
        return getKey("FIRECRAWL_API_KEY");
      },
    }),
    firecrawlPlugin({
      get apiKey() {
        return getKey("FIRECRAWL_API_KEY");
      },
    }),
    e2bPlugin({
      get apiKey() {
        return getKey("E2B_API_KEY");
      },
      get template() {
        return getKey("E2B_TEMPLATE") || undefined;
      },
    }),
  ];
}
