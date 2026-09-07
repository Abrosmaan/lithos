// Заглушки маршрутов волн 2–3 (spec §12): Card (T2.2), Collection/Map/Profile (T3.x).
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

function Stub({ title, note }: { title: string; note: string }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>{title}</Text>
      <Text style={styles.muted}>{note}</Text>
    </View>
  );
}

export function CardScreen({ route }: NativeStackScreenProps<RootStackParamList, 'Card'>) {
  return <Stub title="Карточка" note={`Скоро здесь будет карточка камня. ${route.params.cardId}`} />;
}
export function CollectionScreen() {
  return <Stub title="Коллекция" note="Скоро." />;
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
