import type { CapabilityKey } from '../../agent/capabilities';
import { currentCaps } from '../../agent/capabilities';
import type { Locale } from '../../i18n/locale';

/**
 * Capabilities whose absence blocks common creative tasks (captions). Search/sandbox/web gaps stay silent: they do not block the
 * user-facing workflow this banner exists to unblock.
 */
const BANNER_CAPS: readonly CapabilityKey[] = ['transcription'];

/** Chinese source text doubles as the i18n key; the en dictionary maps it. */
export const CAPABILITY_LABELS: Partial<Record<CapabilityKey, string>> = {
  transcription: '转写',
};

export function missingCreativeCaps(): readonly CapabilityKey[] {
  const caps = currentCaps();
  return BANNER_CAPS.filter((key) => caps[key] !== true);
}

export function formatCapabilityNames(names: readonly string[], locale: Locale): string {
  return locale === 'zh'
    ? names.join('、')
    : new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
}
