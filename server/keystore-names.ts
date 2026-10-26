// Settable env-var whitelists backing the settings UI. Split out of keystore.ts
// (store, seeding, persistence) to keep that file inside the 500-line source gate:
// these lists are the contract with next.config.ts and grow with every provider.
import { LLM_PROVIDER_PRESETS, llmProviderConfigNames } from "../shared/llm-providers.ts";
import { MODEL_CAPABILITY_OVERRIDES_KEY } from "../shared/model-capabilities.ts";

export const KEY_NAMES = [
  "AGENT_IMPORT_ROOTS",
  "PROXY_URL",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_BASE_URL_FORMAT",
  "LLM_ANTHROPIC_API_KEY",
  "LLM_ANTHROPIC_BASE_URL",
  "LLM_ANTHROPIC_MODEL",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "UNSPLASH_ACCESS_KEY",
  "FREESOUND_API_KEY",
  "E2B_API_KEY",
  "E2B_TEMPLATE",
  "FIRECRAWL_API_KEY",
  "UPLOAD_POST_API_KEY",
  "UPLOAD_POST_PROFILE",
  "UPLOAD_POST_BASE_URL",
  "RESOURCE_PREVIEW_TOKEN",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_ENABLED",
  "R2_PRESIGN",
  "MEDIA_DIR",
  // ── model ids (non-secret config; raw values echoed via keyStatus().models) ──
  "LLM_PROVIDER",
  "LLM_MODEL",
  "CLAUDE_CODE_MODEL",
  MODEL_CAPABILITY_OVERRIDES_KEY,
  // ── vendor routing (non-secret config) ──
  "PREFERRED_TRANSCRIPTION_PROVIDER",
  "LOCAL_ASR_MODEL",
  "TRANSCRIPTION_LANGUAGE",
  "TRANSCRIPTION_DIARIZATION",
  "AUTO_TRANSCRIBE_INGEST",
  "UI_SCALE",
  "UI_SCALE_BASE",
  "UI_LOCALE",
  "OPENCHATCUT_SKILLS_DIR",
] as const;

export type KeyName = (typeof KEY_NAMES)[number];

// Names whose VALUES may be sent to the browser (model ids / vendor routing — config,
// not credentials). Deliberately a separate explicit list rather than derived from
// KEY_NAMES: adding a key to the whitelist must never accidentally make it non-secret.
export const NON_SECRET_NAMES: ReadonlySet<string> = new Set([
  "AGENT_IMPORT_ROOTS",
  "PROXY_URL",
  "LLM_PROVIDER",
  "LLM_MODEL",
  "CLAUDE_CODE_MODEL",
  MODEL_CAPABILITY_OVERRIDES_KEY,
  "TRANSCRIPTION_LANGUAGE",
  "TRANSCRIPTION_DIARIZATION",
  "AUTO_TRANSCRIBE_INGEST",
  "UI_SCALE",
  "UI_SCALE_BASE",
  "UI_LOCALE",
  "PREFERRED_TRANSCRIPTION_PROVIDER",
  "LOCAL_ASR_MODEL",
  "R2_ENABLED", // Cloud synchronization switch ('' default = enabled, '0' = disabled) - configuration is not credentials
  "R2_PRESIGN", // Browser pre-signed direct transmission ('' default = enabled, '0' = server-side write-through only)
  "MEDIA_DIR", // Asset saving directory (local path, '' = default public/media/uploads) - configuration is not credentials
  "OPENCHATCUT_SKILLS_DIR", // User skill files directory ('' = ~/.openchatcut/skills) - configuration is not credentials
  ...LLM_PROVIDER_PRESETS.flatMap((preset) => {
    const names = llmProviderConfigNames(preset.id);
    return [names.baseUrl, names.model];
  }),
]);
