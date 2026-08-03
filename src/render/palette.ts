/**
 * Tactical palette.
 *
 * Blue against orange rather than blue against red. Red/green and red/blue
 * oppositions both fail for a meaningful share of players — deuteranopia and
 * protanopia together affect roughly one man in twelve — and a strategy game
 * whose entire read is "whose unit is that" cannot afford to lose that. Blue
 * and orange stay distinct under every common form of colour vision
 * deficiency, and remain distinguishable in greyscale by luminance alone.
 *
 * Shape carries the same information as colour throughout: friendly markers
 * are rounded, opposing markers are angular. Colour is reinforcement, never
 * the sole channel.
 */

export const PALETTE = {
  background: 0x0b0f14,
  panel: 0x121820,

  grid: 0x243040,
  gridStrong: 0x35455a,

  friendly: 0x4a9eff,
  friendlyDim: 0x24567f,
  friendlyGlow: 0x8ac4ff,

  hostile: 0xff8c42,
  hostileDim: 0x8a4a1c,
  hostileGlow: 0xffb27a,

  /** An unidentified return — position known, nature unknown. */
  contact: 0xffd166,
  /** A remembered position that is no longer observed. */
  stale: 0x5b6675,

  selected: 0xffffff,
  moveRange: 0x4a9eff,
  fireRange: 0xff6b6b,
  threat: 0xd7263d,
  sensor: 0x35c9a5,
  objective: 0x7ee787,

  text: 0xe6edf3,
  textDim: 0x8b98a8,

  strengthGood: 0x5dd39e,
  strengthWarn: 0xffd166,
  strengthBad: 0xef476f,
} as const;

/** CSS equivalents for the DOM layer, kept in sync by construction. */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export const CSS_PALETTE = {
  background: css(PALETTE.background),
  panel: css(PALETTE.panel),
  friendly: css(PALETTE.friendly),
  hostile: css(PALETTE.hostile),
  contact: css(PALETTE.contact),
  stale: css(PALETTE.stale),
  text: css(PALETTE.text),
  textDim: css(PALETTE.textDim),
  objective: css(PALETTE.objective),
  threat: css(PALETTE.threat),
  sensor: css(PALETTE.sensor),
} as const;

/** Strength bar colour by remaining fraction. */
export function strengthColor(fraction: number): number {
  if (fraction > 0.6) return PALETTE.strengthGood;
  if (fraction > 0.3) return PALETTE.strengthWarn;
  return PALETTE.strengthBad;
}
