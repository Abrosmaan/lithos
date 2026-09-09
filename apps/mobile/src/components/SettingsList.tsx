// Список настроек (прототип, экран 13): подложка surface radius 16, строки label 14.5 · value 13.5 textDim · шеврон.
// Опасная строка — dangerAccent. Ключи и тексты приходят из lib/settings (чистый модуль).
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../theme';
import { Chevron } from './ui';

export interface SettingsListRow {
  key: string;
  label: string;
  value?: string;
  danger?: boolean;
}

interface Props<K extends string> {
  rows: readonly (SettingsListRow & { key: K })[];
  onPress: (key: K) => void;
}

export function SettingsList<K extends string>({ rows, onPress }: Props<K>) {
  return (
    <View style={styles.list}>
      {rows.map((row, i) => (
        <Pressable
          key={row.key}
          onPress={() => onPress(row.key)}
          accessibilityRole="button"
          accessibilityLabel={row.value ? `${row.label}: ${row.value}` : row.label}
          style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && styles.pressed]}
        >
          <Text style={[styles.label, row.danger && styles.labelDanger]}>{row.label}</Text>
          {row.value ? <Text style={styles.value}>{row.value}</Text> : null}
          <Chevron color={CHEVRON} size={8} />
        </Pressable>
      ))}
    </View>
  );
}

const CHEVRON = '#4d5764';

const styles = StyleSheet.create({
  list: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 15 },
  rowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(242,244,246,0.06)' },
  pressed: { backgroundColor: colors.surface2 },
  label: { flex: 1, fontFamily: fonts.sans, fontSize: 14.5, color: colors.text },
  labelDanger: { color: colors.dangerAccent },
  value: { fontFamily: fonts.sans, fontSize: 13.5, color: colors.textDim },
});
