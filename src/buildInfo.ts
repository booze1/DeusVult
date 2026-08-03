/**
 * Build identity.
 *
 * Playtest feedback is close to useless if you cannot tell which build it
 * came from — "the missile button was greyed out" means something different
 * on a build from before the designation fix. These values are injected at
 * build time and surfaced in the interface, so a screenshot carries its own
 * provenance.
 */

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

/** Short commit SHA, or 'dev' when running from a working tree. */
export const BUILD_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export const BUILD_TIME: string =
  typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

/** Compact stamp for the interface, e.g. "b7f3a21 · 3 Aug". */
export function buildStamp(): string {
  if (!BUILD_TIME) return BUILD_VERSION;
  const date = new Date(BUILD_TIME);
  if (Number.isNaN(date.getTime())) return BUILD_VERSION;
  const label = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${BUILD_VERSION} · ${label}`;
}
