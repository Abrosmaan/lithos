// Коллекция-заглушка (T2.2): список видимых карточек пользователя. Полноценный экран — T3.1.
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../components/BigButton';
import { TierBadge } from '../components/TierBadge';
import { displayName, formatDateRu, rockClassRu } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { listCards } from '../lib/cards';
import { logError, MSG, toUserMessage } from '../lib/errors';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing, tierColor } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Collection'>;

export function CollectionScreen({ navigation }: Props) {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isAlive: () => boolean = () => true) => {
    try {
      const list = await listCards();
      if (!isAlive()) return;
      setCards(list);
      setError(null);
    } catch (e) {
      if (!isAlive()) return;
      logError('collection', e);
      setError(toUserMessage(e, MSG.loadFailed));
    } finally {
      if (isAlive()) setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    void load(() => alive);
    return () => { alive = false; };
  }, [load]));

  if (cards === null) {
    return (
      <View style={styles.center}>
        {error ? (
          <>
            <Text style={styles.muted}>{error}</Text>
            <BigButton label="Обновить" onPress={() => { void load(); }} style={styles.stretch} />
          </>
        ) : (
          <ActivityIndicator color={colors.accent} size="large" />
        )}
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={cards}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={error && cards ? <Text style={styles.errorText}>{error}</Text> : null}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.text} />}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.h1}>Пока пусто</Text>
          <Text style={styles.muted}>Отсканируйте первый камень — он появится здесь.</Text>
          <BigButton label="Сканировать" onPress={() => navigation.popToTop()} style={styles.stretch} />
        </View>
      }
      renderItem={({ item }) => (
        <Pressable onPress={() => navigation.navigate('Card', { cardId: item.id })} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
          <View style={[styles.stripe, { backgroundColor: item.verification === 'pending_review' ? tierColor(null) : tierColor(item.tier) }]} />
          <View style={styles.rowBody}>
            <Text style={styles.name} numberOfLines={1}>{displayName(item)}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {rockClassRu(item.rock_class)}{item.state === 'opened' ? ' · раскрытый' : ''}{formatDateRu(item.created_at) ? ` · ${formatDateRu(item.created_at)}` : ''}
            </Text>
            <View style={styles.badges}>
              <TierBadge tier={item.tier} verification={item.verification} />
              <Text style={styles.score}>{item.score !== null ? `${item.score}` : '—'}</Text>
              {item.provisional && <Text style={styles.prov}>предварительно</Text>}
            </View>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg },
  stretch: { alignSelf: 'stretch' },
  h1: { color: colors.text, fontSize: 22, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
  row: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  rowPressed: { opacity: 0.8 },
  stripe: { width: 6 },
  rowBody: { flex: 1, padding: spacing.md, gap: spacing.xs },
  name: { color: colors.text, fontSize: 18, fontWeight: '700' },
  sub: { color: colors.textMuted, fontSize: 14 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  score: { color: colors.text, fontSize: 15, fontWeight: '600' },
  prov: { color: '#e0c36a', fontSize: 13 },
  errorText: { color: '#e0c36a', fontSize: 14, textAlign: 'center', paddingBottom: spacing.sm },
});
