import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';

export interface SegmentOption<T extends string | boolean> {
  value: T;
  label: string;
}

interface Props<T extends string | boolean> {
  title: string;
  options: readonly SegmentOption<T>[];
  value: T | null;
  /** Повторное нажатие на выбранное — снимает выбор (null). */
  onChange: (value: T | null) => void;
}

export function Segmented<T extends string | boolean>({ title, options, value, onChange }: Props<T>) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.row}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(active ? null : o.value)}
              style={[styles.item, active && styles.itemActive]}
            >
              <Text style={[styles.label, active && styles.labelActive]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  title: { color: colors.textMuted, fontSize: 14 },
  row: { flexDirection: 'row', gap: spacing.sm },
  item: {
    flex: 1, minHeight: 52, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm,
  },
  itemActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { color: colors.text, fontSize: 15, textAlign: 'center' },
  labelActive: { color: colors.accentText, fontWeight: '600' },
});
