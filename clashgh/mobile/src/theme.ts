/**
 * ClashGH theme — flat, dark, product-grade. One accent (gold), neutral
 * surfaces, no gradients or glows. Per-game colours are used only as thin
 * identifiers (a 3px bar, a monogram tile), never as decoration.
 */
export const colors = {
  bg: '#0B0D10',
  surface: '#14171C',
  surfaceAlt: '#1B1F26',
  border: '#262B34',
  borderBright: '#343B47',

  text: '#F2F4F7',
  textMuted: '#9AA3B2',
  textFaint: '#667085',

  gold: '#F2B518',
  goldDim: '#B8860B',
  goldGlow: 'rgba(242,181,24,0.18)',
  cyan: '#4CC3E0',
  cyanGlow: 'rgba(76,195,224,0.15)',
  green: '#3DBE6E',
  red: '#E5484D',
  blue: '#5B8DEF',
  purple: '#9B7BEA',
  orange: '#F0825E',

  overlay: 'rgba(0,0,0,0.6)',
} as const;

/** Per-game identity: short code + colour. No artwork. */
export const GAMES = {
  efootball: { label: 'eFootball', code: 'eF', accent: '#4CC3E0' },
  fc_mobile: { label: 'FC Mobile', code: 'FC', accent: '#3DBE6E' },
  codm: { label: 'CODM', code: 'CD', accent: '#F0825E' },
  dls: { label: 'DLS', code: 'DL', accent: '#9B7BEA' },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 12, xl: 16, pill: 999 } as const;

export const typography = {
  display: 32,
  title: 26,
  heading: 19,
  subheading: 16,
  body: 15,
  caption: 13,
  tiny: 11,
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  black: '800',
} as const;

/** Small uppercase label for section/field names. */
export const eyebrow = {
  fontSize: 11,
  fontWeight: '600' as const,
  letterSpacing: 0.8,
  textTransform: 'uppercase' as const,
};
