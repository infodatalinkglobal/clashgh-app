/**
 * ClashGH theme — esports arena: near-black backdrop, electric gold primary,
 * neon cyan secondary, per-game accent colours. Plain tokens; screens stay
 * dependency-free (gradients come from expo-linear-gradient only).
 */
export const colors = {
  bg: '#07090D',
  bgAlt: '#0B0F15',
  surface: '#111721',
  surfaceAlt: '#182030',
  border: '#232D3D',
  borderBright: '#33405A',

  text: '#F4F7FB',
  textMuted: '#93A0B4',
  textFaint: '#5E6B7E',

  gold: '#FFC61A',
  goldDim: '#B8860B',
  goldGlow: 'rgba(255,198,26,0.45)',
  cyan: '#22D3EE',
  cyanGlow: 'rgba(34,211,238,0.35)',
  green: '#22C55E',
  red: '#F43F5E',
  blue: '#3B82F6',
  purple: '#A855F7',
  orange: '#FB7185',

  overlay: 'rgba(0,0,0,0.6)',
} as const;

/** Per-game accent + key art. Art is original (no trademarks), 16:9. */
export const GAMES = {
  efootball: { label: 'eFootball', accent: '#22D3EE', art: require('../assets/games/efootball.jpg') },
  fc_mobile: { label: 'FC Mobile', accent: '#22C55E', art: require('../assets/games/fc_mobile.jpg') },
  codm: { label: 'CODM', accent: '#FB7185', art: require('../assets/games/codm.jpg') },
  dls: { label: 'DLS', accent: '#A855F7', art: require('../assets/games/dls.jpg') },
} as const;
export const HERO_ART = require('../assets/games/hero.jpg');

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, xl: 22, pill: 999 } as const;

export const typography = {
  display: 34,
  title: 28,
  heading: 20,
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
  black: '900',
} as const;

/** Uppercase, tracked label style used for esports "eyebrow" text. */
export const eyebrow = {
  fontSize: 11,
  fontWeight: '700' as const,
  letterSpacing: 1.6,
  textTransform: 'uppercase' as const,
};
