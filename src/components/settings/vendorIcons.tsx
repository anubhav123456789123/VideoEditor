// Provider marks are vendored from official brand assets where available, plus
// simple-icons (CC0). Static SVGs render inline for consistent sizing;
// monochrome marks inherit the active skin. E2B/local disk/local models use monograms.
import type { CSSProperties } from 'react';
import { theme } from '../../theme';
import claudeSvg from '../../../assets/vendor-icons/claude-color.svg?raw';
import firecrawlSvg from '../../../assets/vendor-icons/firecrawl-color.svg?raw';
import pexelsSvg from '../../../assets/vendor-icons/pexels.svg?raw';
import pixabaySvg from '../../../assets/vendor-icons/pixabay.svg?raw';
import unsplashSvg from '../../../assets/vendor-icons/unsplash.svg?raw';
import freesoundSvg from '../../../assets/vendor-icons/freesound.svg?raw';
import cloudflareSvg from '../../../assets/vendor-icons/cloudflare.svg?raw';

export type VendorId =
  | 'llm' | 'anthropic' | 'pexels' | 'pixabay' | 'unsplash' | 'freesound'
  | 'e2b' | 'firecrawl' | 'r2' | 'localdisk' | 'localasr' | 'proxy' | 'uploadpost';

interface SvgIcon {
  readonly svg: string;
  /** Mono official label (currentColor / no fill) uses this color; leave the color version blank and use your own brand color */
  readonly tint?: string;
}

const PROXY_ICON = '<svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-9-9h18M12 3c2.5 2.6 3.9 5.7 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z"/></svg>';

const SVG_ICONS: Partial<Record<VendorId, SvgIcon>> = {
  anthropic: { svg: claudeSvg },
  firecrawl: { svg: firecrawlSvg },
  pexels: { svg: pexelsSvg, tint: '#05A081' },      // simple-icons single color + official green
  pixabay: { svg: pixabaySvg, tint: '#48A947' },
  unsplash: { svg: unsplashSvg, tint: theme.text }, // simple-icons single color, ink color according to skin
  freesound: { svg: freesoundSvg, tint: '#E85D4C' }, // Site pin + brand red and orange
  r2: { svg: cloudflareSvg, tint: '#F6821F' },      // R2 = Cloudflare product, use Cloudflare official logo
  proxy: { svg: PROXY_ICON }, // network proxy
};

// Official SVG not included / Non-provider brand → monogram
const MONOGRAMS: Partial<Record<VendorId, { bg: string; mono: string; fg?: string }>> = {
  llm: { bg: '#34363c', mono: 'AI', fg: '#f7f7f8' },
  e2b: { bg: '#FF8800', mono: 'E2', fg: '#40230a' },
  localdisk: { bg: '#5f6b7a', mono: 'HD', fg: '#eef2f7' }, // Local disk (non-vendor, neutral gray)
  localasr: { bg: '#3a7d44', mono: 'ASR', fg: '#eaf5ec' }, // On-device ASR (whisper, non-vendor)
  uploadpost: { bg: '#4F46E5', mono: 'UP', fg: '#f7f7f8' }, // Upload-Post social publishing, no official SVG vendored yet
};

interface VendorIconProps {
  vendor: VendorId;
  size?: number;
}

export function VendorIcon({ vendor, size = 18 }: VendorIconProps) {
  const icon = SVG_ICONS[vendor];
  if (icon) {
    const style: CSSProperties = {
      // lobe SVG is 1em×1em → fontSize is the size; simple-icons are normalized by .cc-vendor-icon CSS
      fontSize: size, width: size, height: size, color: icon.tint,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
    };
    // Static codebase assets, non-user input - inline to inherit size and currentColor
    return <span aria-hidden className="cc-vendor-icon" style={style} dangerouslySetInnerHTML={{ __html: icon.svg }} />;
  }
  const brand = MONOGRAMS[vendor] ?? { bg: '#555', mono: '?' };
  const style: CSSProperties = {
    width: size, height: size, borderRadius: Math.round(size * 0.28),
    background: brand.bg, color: brand.fg ?? '#fff',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
    fontSize: Math.round(size * (brand.mono.length > 1 ? 0.44 : 0.58)),
    fontWeight: 700, lineHeight: 1, userSelect: 'none',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif',
  };
  return <span aria-hidden style={style}>{brand.mono}</span>;
}
