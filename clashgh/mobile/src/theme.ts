/**
 * ClashGH theme — dark, low-glare for long match nights, gold accent
 * (Ghana). Kept as plain tokens so screens stay dependency-free.
 */
export const colors = {
  bg: '#0E1116',
  surface: '#161B23',
  surfaceAlt: '#1F2632',
  border: '#2A3342',

  text: '#F2F5F9',
  textMuted: '#93A0B4',
  textFaint: '#5E6B7E',

  gold: '#F5B301',
  goldDim: '#B8860B',
  green: '#2E9E5B',
  red: '#E5484D',
  blue: '#3B82F6',

  overlay: 'rgba(0,0,0,0.6)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const typography = {
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
} as const;
