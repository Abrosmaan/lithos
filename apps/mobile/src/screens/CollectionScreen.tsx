// Коллекция (spec §8, T3.1): сетка 2 колонки, фильтр по тиру (чипы), сортировка, скрытые не показываются.
// Офлайн — кэш AsyncStorage с пометкой. Вход в дневник текущего места — сверху.
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../components/BigButton';
import { CardTile } from '../components/CardTile';
import { Chip } from '../components/Chip';
import type { CardRow } from '../lib/card-types';
import { countByFilter, filterCards, SORT_LABEL_RU, SORT_MODES, sortCards, type SortMode, TIER_FILTER_OPTIONS, type TierFilter } from '../lib/collection';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { loadCards } from '../lib/offline-cache';
import { fetchPrimaryPhotoUrls } from '../lib/photo-urls';
import type { TabScreenProps } from '../navigation/types';
import { colors, radius, spacing, tierColor } from '../theme';

type Props = TabScreenProps<'Collection'>;

export const OFFLINE_NOTE = 'Нет связи — показана сохранённая коллекция.';

export function CollectionScreen({ navigation }: Props) {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SortMode>('newest');
  const [filter, setFilter] = useState<TierFilter>(null);
  const seq = useRef(0);

  const load = useCallback(async (isFocused: () => boolean = () => true) => {
    const my = ++seq.current; // параллельные load (фокус + pull-to-refresh): побеждает последний
    const isAlive = () => isFocused() && my === seq.current;
    try {
      const { data, offline: off } = await loadCards();
      if (!isAlive()) return;
      setCards(data);
      setOffline(off);
      setError(null);
      const photos = await fetchPrimaryPhotoUrls(data.filter((c) => !c.hidden).map((c) => c.scan_id));
      if (isAlive()) setUrls(photos);
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

  const visible = useMemo(() => (cards ? sortCards(filterCards(cards, filter), sort) : []), [cards, filter, sort]);
  const counts = useMemo(() => (cards ? countByFilter(cards) : new Map<TierFilter, number>()), [cards]);
  const total = counts.get(null) ?? 0;
  // Нечётное число плиток: последняя не растягивается на всю ширину — добавляем пустой спейсер.
  const grid = useMemo<(CardRow | null)[]>(() => (visible.length % 2 === 1 ? [...visible, null] : visible), [visible]);
  const toCamera = () => navigation.navigate('Tabs', { screen: 'Camera' }, { pop: true });

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

  const header = (
    <View style={styles.header}>
      {offline && <Text style={styles.note}>{OFFLINE_NOTE}</Text>}
      {error && !offline && <Text style={styles.note}>{error}</Text>}
      <Pressable onPress={() => navigation.navigate('Diary')} accessibilityRole="button" style={({ pressed }) => [styles.diary, pressed && styles.pressed]}>
        <Text style={styles.diaryTitle}>Дневник места</Text>
        <Text style={styles.diaryText}>Что ожидается там, где вы сейчас, и что уже найдено →</Text>
      </Pressable>
      {total > 0 && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {TIER_FILTER_OPTIONS.map((o) => (
              <Chip
                key={String(o.value)}
                label={`${o.label} · ${counts.get(o.value) ?? 0}`}
                selected={filter === o.value}
                color={o.value && o.value !== 'none' ? tierColor(o.value) : colors.accent}
                onPress={() => setFilter(o.value)}
              />
            ))}
          </ScrollView>
          <View style={styles.chips}>
            {SORT_MODES.map((m) => (
              <Chip key={m} label={SORT_LABEL_RU[m]} selected={sort === m} onPress={() => setSort(m)} />
            ))}
          </View>
        </>
      )}
    </View>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      columnWrapperStyle={styles.column}
      numColumns={2}
      data={grid}
      keyExtractor={(c) => c?.id ?? 'spacer'}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.text} />}
      ListEmptyComponent={
        total === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.h1}>Пока пусто</Text>
            <Text style={styles.muted}>Отсканируйте первый камень — он появится здесь.</Text>
            <BigButton label="Сканировать" onPress={toCamera} style={styles.stretch} />
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.muted}>Таких карточек пока нет.</Text>
            <BigButton label="Показать все" variant="secondary" onPress={() => setFilter(null)} style={styles.stretch} />
          </View>
        )
      }
      renderItem={({ item }) =>
        item ? <CardTile card={item} photoUrl={urls.get(item.scan_id)} onPress={() => navigation.navigate('Card', { cardId: item.id })} /> : <View style={styles.spacer} />
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  column: { gap: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  stretch: { alignSelf: 'stretch' },
  h1: { color: colors.text, fontSize: 22, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
  header: { gap: spacing.sm, paddingBottom: spacing.xs },
  note: { color: '#e0c36a', fontSize: 14, textAlign: 'center' },
  diary: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 2, borderWidth: 1, borderColor: colors.border },
  pressed: { opacity: 0.8 },
  diaryTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  diaryText: { color: colors.textMuted, fontSize: 14 },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'nowrap' },
  spacer: { flex: 1 },
});
