// Заглушка Result: реальный экран (Realtime по scan_id, тир, факты, лор) — T2.2.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../components/BigButton';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Result'>;

export function ResultScreen({ navigation, route }: Props) {
  return (
    <View style={styles.screen}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.h1}>Определяем камень…</Text>
      <Text style={styles.muted}>Фото загружены, скан в очереди. Результат появится здесь.</Text>
      <Text style={styles.id} selectable>
        scan_id: {route.params.scanId}
      </Text>
      <BigButton label="Новый скан" variant="secondary" onPress={() => navigation.popToTop()} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  h1: { color: colors.text, fontSize: 22, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
  id: { color: colors.textMuted, fontSize: 12, fontFamily: 'Menlo' },
  button: { alignSelf: 'stretch', marginTop: spacing.lg },
});
