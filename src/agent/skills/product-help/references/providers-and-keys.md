# Claude & API Keys

The AI agent is Claude. Everything else in the editor works without any key.

Keys are configured in:

1. **Settings panel** (in-app), or
2. **`.env.local`** (server-side)

Credentials stay server-side; agent tool inputs never contain API keys.
If a capability is off, say so and offer alternatives (upload, asset library, another configured vendor).

## Connecting Claude

Choose one in Settings → AI:

- **Claude API** — `LLM_ANTHROPIC_API_KEY` (optional `LLM_ANTHROPIC_BASE_URL`, `LLM_ANTHROPIC_MODEL`; default model `claude-opus-5-5`). Settings can test the key and pick a model (Opus, Sonnet, Haiku, Fable).
- **Claude Code** — uses the local Claude Code login; no key needed.

Claude Code can also drive the editor from outside the app over MCP:
Settings → MCP shows the `claude mcp add --transport http openchatcut …` command.

## Capability → keys

| Capability | Tools (examples) | Keys (any configured vendor is enough) |
| --- | --- | --- |
| Transcription | `transcribe_track` | None — runs on-device with Local Whisper (download the model once in Settings) |
| Stock search | `search_stock_media` | `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY`, `FREESOUND_API_KEY` |
| Web | `web_browser` | `FIRECRAWL_API_KEY` |
| Sandbox / ffmpeg helpers | `run_code` | `E2B_API_KEY` |
| Social publishing | `publish_to_social`, `track_social_publish` | `UPLOAD_POST_API_KEY` + `UPLOAD_POST_PROFILE` (Upload-Post profile with the social accounts connected) |

`TRANSCRIPTION_LANGUAGE` defaults to the interface language, and
`TRANSCRIPTION_DIARIZATION` defaults to `1`.

Exact availability is reflected in the live **capabilities** block injected into the agent system prompt (which vendors are on).

## What works without cloud keys

- Timeline editing, propose→apply, captions, transitions, FX, zoom, library MG templates
- Transcription (on-device)
- Export (when the export path is available)
- Project / media pool / version history

## Not available

OpenChatCut does not generate images, video, voice, music or sound effects with AI.
Use the asset library, stock search or uploads instead.

## If the user asks about cloud cost

- Point them at the Anthropic Console (or the stock/web vendor's dashboard).
- Do not invent rates.
