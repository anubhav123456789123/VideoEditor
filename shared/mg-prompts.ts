// System prompts for Claude-authored motion graphics. The Remotion contract is
// shared by the agent's create_motion_graphic tool and the Motion Graphics tab;
// the HyperFrames contract backs the tab's HTML engine.

/** Remotion MG component contract (verbatim from the agent's create_motion_graphic tool). */
export function remotionMgSystemPrompt(brandHint = ''): string {
  return `You write ONE Remotion motion-graphic React component. Output ONLY the code — no markdown fences, no prose.
Contract (MUST follow exactly):
- Shape: const Name = ({item}) => { ...; return (<AbsoluteFill>...</AbsoluteFill>); };
- NO import / require / export. These globals are already injected: React, useCurrentFrame, useVideoConfig, interpolate, interpolateColors, spring, Easing, random, Img, Audio, Sequence, AbsoluteFill.
- Canvas is 1920x1080. Animate with useCurrentFrame()+interpolate()/spring({fps,frame,config}). Get { fps, durationInFrames } from useVideoConfig().
- interpolate()'s inputRange MUST be strictly increasing (e.g. [0, 15, 30]). When breakpoints are computed (per-item offsets, durationInFrames fractions), clamp with Math.max(prev + 1, next) so a later value can never be <= an earlier one — a non-monotonic inputRange throws at render time.
- Pure, synchronous rendering only. FORBIDDEN: fetch, XMLHttpRequest, WebSocket, document, window, globalThis, eval, new Function, .constructor, localStorage, setTimeout, setInterval, while(true), for(;;), debugger.
- Style inline. Make it clean and visually appealing (large readable text, tasteful colors, smooth fade/slide/scale animations).${brandHint}`;
}

/** Extra guidance for the Motion Graphics tab's Remotion engine (appended to the shared contract). */
export function remotionTabGuidance(opts: { width: number; height: number; seconds: number }): string {
  return `

Motion Graphics tab:
- The graphic is an OVERLAY on video unless the request asks for a full-screen background: keep the root background transparent.
- Target canvas: ${opts.width}x${opts.height}. Scale from a 1920x1080 design with Math.min(item.width/1920, item.height/1080) when the canvas differs.
- Duration: ${opts.seconds} seconds. Animate in, hold long enough to read, and animate out before the last frame.
- Expose editable text and colors through item.props with sensible defaults (e.g. const title = item.props?.title ?? 'Headline').`;
}

/** HyperFrames composition contract (HeyGen HyperFrames, rendered by @hyperframes/producer). */
export function hyperframesSystemPrompt(opts: { width: number; height: number; seconds: number }): string {
  const { width, height, seconds } = opts;
  return `You write ONE HyperFrames HTML composition (HeyGen HyperFrames: HTML + CSS + a paused GSAP timeline, rendered to video frame by frame). Output ONLY the complete HTML document — no markdown fences, no prose.
Contract (MUST follow exactly):
- <meta name="viewport" content="width=${width}, height=${height}" /> in <head>.
- Load GSAP with exactly <script src="gsap.min.js"></script> (a local copy is provided). No other scripts, no CDN, no fetch / XMLHttpRequest / WebSocket, no external images or video.
- The root element is <div id="stage" data-composition-id="mg" data-width="${width}" data-height="${height}"> and wraps every clip; data-composition-id appears on this element only.
- html, body and #stage are exactly ${width}px x ${height}px with overflow:hidden. The background is TRANSPARENT (background: transparent) unless the request asks for a full-screen background.
- Every timed element has class="clip", data-start (seconds), data-duration (seconds) and data-track-index (higher = in front). .clip { position:absolute; visibility:hidden; } — the framework owns visibility; never animate or toggle visibility yourself.
- Create ONE paused timeline: var tl = gsap.timeline({ paused: true }); animate only visual properties (opacity, x, y, scale, rotation, color, clipPath, filter). Set initial transforms with tl.set(...) at time 0, not with CSS transform (GSAP overwrites CSS transforms). Never tween width/height/left/top/margin. End with tl.set({}, {}, ${seconds}); so the composition lasts exactly ${seconds} seconds.
- Register it: window.__timelines = window.__timelines || {}; window.__timelines["mg"] = tl;
- Deterministic only: no Math.random without a fixed seed, no Date, no timers, no requestAnimationFrame.
- Fonts: system-ui / -apple-system stacks, or Fontshare families via <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,700&display=swap"> (swap the family slug as needed) with a system fallback.
- Design: clean, modern, minimal; large readable type; smooth eased motion (power2/power3/expo); animate in, hold, animate out before ${seconds}s.`;
}

/** Strip a stray markdown fence the model may wrap its answer in. */
export function stripCodeFence(text: string): string {
  return text.trim().replace(/^\s*```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}
