// Тёмная тема: камера и все экраны прототипа. Простые крупные элементы.
export const colors = {
  bg: '#0b0f14',
  surface: '#161c24',
  surfaceActive: '#24303d',
  border: '#2c3742',
  accent: '#1f6f5f',
  accentText: '#ffffff',
  text: '#f2f4f6',
  textMuted: '#9aa5b1',
  danger: '#b03a2e',
  warning: '#8a6d1f',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, full: 999 } as const;

// Цвета тиров — оформление, не баланс (пороги тиров — в @lithos/shared).
export const tierColors = {
  common: '#8f9aa6',
  uncommon: '#3fa06a',
  rare: '#3b82f6',
  epic: '#9b5de5',
  legendary: '#e0a526',
  none: '#5b6673',
} as const;

export function tierColor(tier: keyof typeof tierColors | null | undefined): string {
  return tier ? tierColors[tier] : tierColors.none;
}
