import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Цвет выбранного чипа (например, цвет тира); по умолчанию — акцент. */
  color?: string;
  style?: ViewStyle;
}

/** Чип фильтра/сортировки: крупный, чтобы попадать пальцем на улице. */
export function Chip({ label, selected, onPress, color = colors.accent, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, selected && { backgroundColor: color, borderColor: color }, pressed && styles.pressed, style]}
    >
      <Text style={[styles.text, selected && styles.textSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pressed: { opacity: 0.8 },
  text: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  textSelected: { color: '#fff' },
});
