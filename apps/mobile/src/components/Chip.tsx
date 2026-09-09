import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, fonts, radius } from '../theme';

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Цвет выбранного чипа (например, цвет тира); по умолчанию — accentBright. */
  color?: string;
  /** Mono-счётчик справа от подписи (фильтры тира). */
  count?: number | string;
  /** sort — компактный чип сортировки: выбранный surface2, невыбранный прозрачный. */
  variant?: 'filter' | 'sort';
  style?: ViewStyle;
}

/** Чипы фильтра/сортировки (DESIGN_SYSTEM.md): выбранный фильтр заливается цветом тира, текст тёмный. */
export function Chip({ label, selected, onPress, color = colors.accentBright, count, variant = 'filter', style }: Props) {
  const sort = variant === 'sort';
  const bg = sort ? (selected ? colors.surface2 : 'transparent') : selected ? color : colors.surface;
  const border = sort ? (selected ? 'rgba(242,244,246,0.16)' : colors.divider) : selected ? color : colors.border;
  const fg = sort ? (selected ? colors.text : colors.textMuted) : selected ? colors.bg : colors.chipText;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, sort && styles.sort, { backgroundColor: bg, borderColor: border }, pressed && styles.pressed, style]}
    >
      <Text style={[styles.text, sort && styles.sortText, { color: fg }]}>{label}</Text>
      {count !== undefined ? <Text style={[styles.count, { color: fg }]}>{count}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 13, borderRadius: radius.full, borderWidth: 1 },
  sort: { paddingVertical: 8 },
  pressed: { opacity: 0.85 },
  text: { fontFamily: fonts.sansMedium, fontSize: 13 },
  sortText: { fontSize: 12.5 },
  count: { fontFamily: fonts.mono, fontSize: 11, opacity: 0.75 },
});
