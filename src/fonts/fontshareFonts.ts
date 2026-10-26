// Fontshare (Indian Type Foundry) families, free for personal and commercial use
// under the ITF Free Font License. The licence does not allow redistributing the
// font files, so nothing is bundled: faces are loaded at runtime from the
// Fontshare CSS API, in the editor and in headless export alike (ensureFont).

export interface FontshareFont {
  family: string;
  /** Fontshare API slug (https://api.fontshare.com/v2/css?f[]=<slug>@…). */
  slug: string;
  /** Static weights the family ships; requests stay within them. */
  weights: readonly number[];
  style: 'sans' | 'serif' | 'display';
}

export const FONTSHARE_FONTS: readonly FontshareFont[] = [
  { family: 'Satoshi', slug: 'satoshi', weights: [300, 400, 500, 700, 900], style: 'sans' },
  { family: 'General Sans', slug: 'general-sans', weights: [300, 400, 500, 600, 700], style: 'sans' },
  { family: 'Switzer', slug: 'switzer', weights: [300, 400, 500, 600, 700, 800, 900], style: 'sans' },
  { family: 'Cabinet Grotesk', slug: 'cabinet-grotesk', weights: [300, 400, 500, 700, 800, 900], style: 'sans' },
  { family: 'Supreme', slug: 'supreme', weights: [300, 400, 500, 700, 800], style: 'sans' },
  { family: 'Clash Grotesk', slug: 'clash-grotesk', weights: [300, 400, 500, 600, 700], style: 'sans' },
  { family: 'Synonym', slug: 'synonym', weights: [300, 400, 500, 600, 700], style: 'sans' },
  { family: 'Author', slug: 'author', weights: [300, 400, 500, 600, 700], style: 'sans' },
  { family: 'Clash Display', slug: 'clash-display', weights: [300, 400, 500, 600, 700], style: 'display' },
  { family: 'Chillax', slug: 'chillax', weights: [300, 400, 500, 600, 700], style: 'display' },
  { family: 'Panchang', slug: 'panchang', weights: [300, 400, 500, 600, 700, 800], style: 'display' },
  { family: 'Tanker', slug: 'tanker', weights: [400], style: 'display' },
  { family: 'Boska', slug: 'boska', weights: [300, 400, 500, 700, 900], style: 'serif' },
  { family: 'Zodiak', slug: 'zodiak', weights: [300, 400, 700, 800, 900], style: 'serif' },
  { family: 'Gambetta', slug: 'gambetta', weights: [300, 400, 500, 600, 700], style: 'serif' },
  { family: 'Erode', slug: 'erode', weights: [300, 400, 500, 600, 700], style: 'serif' },
  { family: 'Sentient', slug: 'sentient', weights: [300, 400, 500, 700], style: 'serif' },
  { family: 'Bespoke Serif', slug: 'bespoke-serif', weights: [300, 400, 500, 700, 800], style: 'serif' },
];

const LOAD_TIMEOUT_MS = 15_000;

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function findFontshareFont(family: string): FontshareFont | undefined {
  const key = normalize(family);
  return FONTSHARE_FONTS.find((font) => normalize(font.family) === key || normalize(font.slug) === key);
}

/** Closest shipped weight to the requested one. */
export function nearestFontshareWeight(font: FontshareFont, weight: number): number {
  return font.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), font.weights[0]!);
}

export function fontshareCssUrl(font: FontshareFont): string {
  return `https://api.fontshare.com/v2/css?f[]=${font.slug}@${font.weights.join(',')}&display=swap`;
}

const stylesheetLoads = new Map<string, Promise<void>>();
const faceLoads = new Map<string, Promise<void>>();

function loadStylesheet(font: FontshareFont): Promise<void> {
  const cached = stylesheetLoads.get(font.slug);
  if (cached) return cached;
  const promise = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontshareCssUrl(font);
    link.dataset.fontshare = font.slug;
    const timer = window.setTimeout(() => reject(new Error(`Fontshare stylesheet timed out: ${font.family}`)), LOAD_TIMEOUT_MS);
    link.onload = () => { window.clearTimeout(timer); resolve(); };
    link.onerror = () => { window.clearTimeout(timer); link.remove(); reject(new Error(`Fontshare stylesheet failed: ${font.family}`)); };
    document.head.appendChild(link);
  });
  promise.catch(() => stylesheetLoads.delete(font.slug));
  stylesheetLoads.set(font.slug, promise);
  return promise;
}

/** Load one Fontshare face and resolve once the browser can draw it (fails closed like ensureFont). */
export function ensureFontshareFont(family: string, weight = 400): Promise<void> {
  const font = findFontshareFont(family);
  if (!font) return Promise.resolve();
  if (typeof document === 'undefined') return Promise.resolve();
  const resolvedWeight = nearestFontshareWeight(font, weight);
  const key = `${font.slug}@${resolvedWeight}`;
  const cached = faceLoads.get(key);
  if (cached) return cached;
  const promise = loadStylesheet(font)
    .then(() => document.fonts.load(`${resolvedWeight} 1em "${font.family}"`))
    .then((faces) => {
      if (!faces.length) throw new Error(`Fontshare face unavailable: ${font.family} ${resolvedWeight}`);
    });
  promise.catch(() => faceLoads.delete(key));
  faceLoads.set(key, promise);
  return promise;
}
