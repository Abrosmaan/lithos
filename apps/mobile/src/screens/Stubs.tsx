// Заглушки маршрутов волны 3 (spec §12): Map / Profile (T3.x).
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

function Stub({ title, note }: { title: string; note: string }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>{title}</Text>
      <Text style={styles.muted}>{note}</Text>
    </View>
  );
}

export function MapScreen() {
  return <Stub title="Карта" note="Скоро." />;
}
export function ProfileScreen() {
  return <Stub title="Профиль" note="Скоро." />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
  h1: { color: colors.text, fontSize: 22, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
});
