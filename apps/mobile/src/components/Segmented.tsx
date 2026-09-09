// Segmented из прототипа (DESIGN_SYSTEM.md): mono-подпись секции, три равных кнопки 13.5/500, radius 12;
// выбранный — accent + accentText, невыбранный — surface с рамкой. Повторный тап снимает выбор.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { SectionLabel } from './ui';

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
      <SectionLabel>{title}</SectionLabel>
      <View style={styles.row}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(active ? null : o.value)}
              style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && styles.pressed]}
            >
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1} adjustsFontSizeToFit>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', gap: 7 },
  item: {
    flex: 1, minHeight: 44, paddingVertical: 13, paddingHorizontal: 4, borderRadius: 12, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  itemActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { opacity: 0.85 },
  label: { fontFamily: fonts.sansMedium, fontSize: 13.5, lineHeight: 17, color: colors.text, textAlign: 'center' },
  labelActive: { color: colors.accentText },
});
