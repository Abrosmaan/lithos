// Дизайн-система Lithos — токены из прототипа docs/design/Lithos App.dc.html (см. docs/design/DESIGN_SYSTEM.md).
// Тёмная тема. Три шрифта: Playfair (названия, лор), Golos (интерфейс), JetBrains Mono (числа, ID, подписи секций).
// Балансовых чисел здесь нет — только оформление.
import type { TextStyle } from 'react-native';

export const colors = {
  bg: '#0b0f14',
  bgDeep: '#07090c',
  surface: '#161c24',
  surface2: '#1f2733',
  surfaceAlt: '#1c2029',
  surfaceDim: '#1a212a',
  surfaceActive: '#24303d',
  track: '#0f141b',
  border: 'rgba(242,244,246,0.09)',
  divider: 'rgba(242,244,246,0.08)',
  borderStrong: 'rgba(242,244,246,0.14)',
  accent: '#1f6f5f',
  accentBright: '#3fbfa3',
  accentSoft: '#7ae0c8',
  accentText: '#eafff8',
  accentTint: 'rgba(31,111,95,0.16)',
  accentBorder: 'rgba(63,191,163,0.32)',
  text: '#f2f4f6',
  textSoft: '#dfe4e9',
  textMuted: '#9aa5b1',
  textDim: '#6f7b88',
  textFaint: '#5b6673',
  chipText: '#c3cbd4',
  danger: '#b03a2e',
  dangerText: '#f0a99f',
  dangerTextSoft: '#f0c8c1',
  dangerAccent: '#e0857a',
  dangerBg: '#251b1a',
  dangerToastBg: '#2a1a18',
  dangerTint: 'rgba(176,58,46,0.14)',
  dangerBorder: 'rgba(176,58,46,0.45)',
  gold: '#e0a526',
  goldText: '#e8d5aa',
  goldTint: 'rgba(224,165,38,0.16)',
  goldBorder: 'rgba(224,165,38,0.35)',
  warning: '#8a6d1f',
  tabBar: 'rgba(15,20,27,0.96)',
  overlay: 'rgba(7,9,12,0.86)',
  scrim: 'rgba(11,15,20,0.8)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { xs: 8, sm: 10, md: 14, lg: 16, xl: 22, full: 999 } as const;

/** Плотность «Просторная» из прототипа: gap 19, padding карточки 19, плитка фото 134, сетка 12. */
export const density = { gap: 19, pad: 19, tile: 134, grid: 12 } as const;

/** Имена шрифтов, как их регистрирует expo-font (App.tsx). Fallback — системный, пока шрифты грузятся. */
export const fonts = {
  serif: 'PlayfairDisplay_600SemiBold',
  serifMedium: 'PlayfairDisplay_500Medium',
  serifRegular: 'PlayfairDisplay_400Regular',
  sans: 'GolosText_400Regular',
  sansMedium: 'GolosText_500Medium',
  sansSemi: 'GolosText_600SemiBold',
  sansBold: 'GolosText_700Bold',
  mono: 'JetBrainsMono_500Medium',
  monoRegular: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

/** Готовые текстовые стили. Использовать вместо ручных fontSize/fontWeight. */
export const type = {
  h1: { fontFamily: fonts.serif, fontSize: 27, lineHeight: 30, color: colors.text } satisfies TextStyle,
  h2: { fontFamily: fonts.serif, fontSize: 24, lineHeight: 29, color: colors.text } satisfies TextStyle,
  h3: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 28, color: colors.text } satisfies TextStyle,
  tierName: { fontFamily: fonts.serif, fontSize: 19, lineHeight: 21 } satisfies TextStyle,
  tileName: { fontFamily: fonts.serif, fontSize: 14.5, lineHeight: 18, color: colors.text } satisfies TextStyle,
  lore: { fontFamily: fonts.serifRegular, fontSize: 15, lineHeight: 23, color: colors.textSoft } satisfies TextStyle,
  body: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 21, color: colors.text } satisfies TextStyle,
  bodyStrong: { fontFamily: fonts.sansSemi, fontSize: 14.5, lineHeight: 21, color: colors.text } satisfies TextStyle,
  small: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: colors.textMuted } satisfies TextStyle,
  caption: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: colors.textDim } satisfies TextStyle,
  button: { fontFamily: fonts.sansSemi, fontSize: 16, lineHeight: 20, color: colors.accentText } satisfies TextStyle,
  buttonSm: { fontFamily: fonts.sansSemi, fontSize: 14.5, lineHeight: 18, color: colors.text } satisfies TextStyle,
  sectionLabel: { fontFamily: fonts.mono, fontSize: 10, lineHeight: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.textDim } satisfies TextStyle,
  brand: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 12, letterSpacing: 3.7, color: colors.accentBright } satisfies TextStyle,
  mono: { fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 16, color: colors.textMuted } satisfies TextStyle,
  monoId: { fontFamily: fonts.monoRegular, fontSize: 11, lineHeight: 13, letterSpacing: 0.7, color: colors.textFaint } satisfies TextStyle,
  scoreBig: { fontFamily: fonts.monoBold, fontSize: 34, lineHeight: 36, color: colors.text } satisfies TextStyle,
  scoreMid: { fontFamily: fonts.monoBold, fontSize: 26, lineHeight: 28, color: colors.text } satisfies TextStyle,
  statValue: { fontFamily: fonts.monoBold, fontSize: 24, lineHeight: 26, color: colors.text } satisfies TextStyle,
  stepNumber: { fontFamily: fonts.monoBold, fontSize: 11, lineHeight: 12, color: colors.accentBright } satisfies TextStyle,
} as const;

// Цвета тиров — оформление, не баланс (пороги тиров — в @lithos/shared).
export const tierColors = {
  common: '#8f9aa6',
  uncommon: '#3fa06a',
  rare: '#3b82f6',
  epic: '#9b5de5',
  legendary: '#e0a526',
  none: '#5b6673',
} as const;

/** Карта: подсветка ячейки с закрытым дневником (оформление). */
export const mapColors = {
  cellFill: 'rgba(224,165,38,0.14)',
  cellStroke: 'rgba(224,165,38,0.45)',
} as const;

export function tierColor(tier: keyof typeof tierColors | null | undefined): string {
  return tier ? tierColors[tier] : tierColors.none;
}

/** Диапазон очков тира для подписи (оформление; пороги — из shared TIER_THRESHOLDS через tierRange()). */
export const placeholderStripes = { a: '#1e2632', b: '#26303e' } as const;
