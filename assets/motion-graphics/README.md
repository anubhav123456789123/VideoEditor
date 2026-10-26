# Motion graphics

Two engines are supported:

- **Remotion** (`.jsx` / `.tsx`): one component in the OpenChatCut MG template
  contract — `const Name = ({ item }) => …`, no imports; `React`, `useCurrentFrame`,
  `useVideoConfig`, `interpolate`, `spring`, `Easing`, `AbsoluteFill`, … are injected.
  Design on a 1920×1080 canvas. Editable values come from `item.props`.
- **HyperFrames** (`.html`): a HeyGen HyperFrames composition — HTML + CSS + a paused
  GSAP timeline registered on `window.__timelines["mg"]`. Load GSAP with
  `<script src="gsap.min.js"></script>` (a local copy is provided at render time).
  It is rendered to a transparent ProRes 4444 `.mov` when added to the timeline.

Sidecar `<name>.json`: `name`, `description`, `durationInFrames` (Remotion) or
`durationSeconds` (HyperFrames), `width`, `height`, `props`.

The Motion Graphics tab saves Claude-generated graphics into `generated/`.
