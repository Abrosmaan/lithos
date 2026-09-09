// Плашка статистики профиля: surface, radius 15, mono 24 + подпись 12 (прототип, экран 13).
import { StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme';

export function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={type.statValue}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, paddingVertical: 15, paddingHorizontal: 13, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider, gap: 5 },
  label: { ...type.small, fontSize: 12, lineHeight: 16 },
});
