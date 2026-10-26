import { parse as parseDotenv } from 'dotenv';

/** Keep the checkout's explicit .env.local LLM_PROVIDER authoritative over
 *  unrelated host-shell values (isolated profiles stay wrapper-controlled). */
export function applyAuthoritativeLocalProvider(
  env: Record<string, string>,
  source: string,
): void {
  const parsed = parseDotenv(source);
  const fileProvider = parsed.LLM_PROVIDER;
  if (fileProvider !== undefined) env.LLM_PROVIDER = fileProvider.trim();
}
