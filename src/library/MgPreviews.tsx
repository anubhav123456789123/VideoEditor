// Live previews for motion graphics: Remotion components play in
// @remotion/player; HyperFrames compositions play in a sandboxed srcdoc iframe
// with GSAP inlined and clip visibility driven from data-start / data-duration
// (the producer's runtime does this at render time).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { prepareTemplate, type MgComponent } from '../template-host';

let gsapSource: Promise<string> | null = null;
function loadGsap(): Promise<string> {
  gsapSource ??= fetch('/api/mg/gsap.js').then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
  return gsapSource;
}

/** Preview document: GSAP inlined, timeline looped, clip visibility synced to data-start / data-duration. */
function previewDocument(html: string, gsap: string): string {
  const inlined = html.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*gsap[^"']*["'][^>]*>\s*<\/script>/gi, () => `<script>${gsap.replace(/<\/script/gi, '<\\/script')}</script>`);
  const shim = `<script>(function(){var tl=window.__timelines&&(window.__timelines.mg||Object.values(window.__timelines)[0]);if(!tl)return;
var clips=Array.prototype.slice.call(document.querySelectorAll('[data-start]'));
function sync(){var t=tl.time();clips.forEach(function(c){var s=+c.getAttribute('data-start')||0;var d=parseFloat(c.getAttribute('data-duration'));if(!isFinite(d))d=1e9;c.style.visibility=(t>=s&&t<s+d)?'visible':'hidden';});}
tl.eventCallback('onUpdate',sync);tl.repeat(-1);tl.play(0);sync();})();</script>`;
  return inlined.includes('</body>') ? inlined.replace('</body>', `${shim}</body>`) : inlined + shim;
}

export function RemotionPreview({ code, fps, width, height, seconds, controls = true }: { code: string; fps: number; width: number; height: number; seconds: number; controls?: boolean }) {
  const [component, setComponent] = useState<MgComponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    prepareTemplate(code).then((c) => { if (alive) setComponent(() => c); }, (e: unknown) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [code]);
  const inputProps = useMemo(() => ({ item: { props: {}, width, height } }), [width, height]);
  if (error) return <div className="flex h-full items-center justify-center p-3 text-[11px] text-destructive">{error}</div>;
  if (!component) return null;
  return (
    <Player
      component={component as never}
      inputProps={inputProps}
      durationInFrames={Math.max(15, Math.round(seconds * fps))}
      fps={fps}
      compositionWidth={width}
      compositionHeight={height}
      style={{ width: '100%', height: '100%' }}
      autoPlay
      loop
      controls={controls}
    />
  );
}

export function HyperframesPreview({ html, width, height }: { html: string; width: number; height: number }) {
  const [doc, setDoc] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.2);
  useEffect(() => {
    let alive = true;
    loadGsap().then((gsap) => { if (alive) setDoc(previewDocument(html, gsap)); }, () => { if (alive) setDoc(html); });
    return () => { alive = false; };
  }, [html]);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setScale(box.clientWidth / width));
    observer.observe(box);
    return () => observer.disconnect();
  }, [width]);
  return (
    <div ref={boxRef} className="absolute inset-0">
      {doc && (
        <iframe
          title="HyperFrames preview"
          sandbox="allow-scripts"
          srcDoc={doc}
          style={{ width, height, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', background: 'transparent' }}
        />
      )}
    </div>
  );
}
