// Коллекция (spec §8, T3.1; DESIGN_SYSTEM.md экран 10): H1 + mono-счётчик, вход в дневник места, чипы тиров
// (со счётчиком) и сортировки, сетка 2 колонки. Скрытые карточки (родители после раскола) не показываются.
// Офлайн — кэш AsyncStorage с пометкой. Логика загрузки/фильтра/сортировки не менялась при рестайле.
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../components/BigButton';
import { CardTile } from '../components/CardTile';
import { Chip } from '../components/Chip';
import { Note } from '../components/ui';
import type { CardRow } from '../lib/card-types';
import { countByFilter, filterCards, SORT_LABEL_RU, SORT_MODES, sortCards, type SortMode, TIER_FILTER_OPTIONS, type TierFilter } from '../lib/collection';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { loadCards } from '../lib/offline-cache';
import { fetchPrimaryPhotoUrls } from '../lib/photo-urls';
import { cardsCountText } from '../lib/screen-text';
import type { TabScreenProps } from '../navigation/types';
import { colors, density, fonts, placeholderStripes, radius, tierColor, type } from '../theme';

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
            <Text style={type.small}>{error}</Text>
            <BigButton label="Обновить" onPress={() => { void load(); }} />
          </>
        ) : (
          <ActivityIndicator color={colors.accent} size="large" />
        )}
      </View>
    );
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Коллекция</Text>
        <Text style={styles.count}>{cardsCountText(total)}</Text>
      </View>

      {offline && <Note tone="neutral">{OFFLINE_NOTE}</Note>}
      {error && !offline && <Note tone="danger">{error}</Note>}

      <Pressable onPress={() => navigation.navigate('Diary')} accessibilityRole="button" style={({ pressed }) => [styles.diary, pressed && styles.pressed]}>
        <View style={styles.diaryIcon}>
          <View style={styles.diaryIconMark} />
        </View>
        <View style={styles.diaryBody}>
          <Text style={styles.diaryTitle}>Дневник места</Text>
          <Text style={styles.diaryText}>Что ожидается там, где вы сейчас, и что уже найдено</Text>
        </View>
      </Pressable>

      {total > 0 && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {TIER_FILTER_OPTIONS.map((o) => (
              <Chip
                key={String(o.value)}
                label={o.label}
                count={counts.get(o.value) ?? 0}
                selected={filter === o.value}
                color={o.value && o.value !== 'none' ? tierColor(o.value) : colors.accentBright}
                onPress={() => setFilter(o.value)}
              />
            ))}
          </ScrollView>
          <View style={styles.chips}>
            {SORT_MODES.map((m) => (
              <Chip key={m} label={SORT_LABEL_RU[m]} variant="sort" selected={sort === m} onPress={() => setSort(m)} />
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
            <View style={styles.emptyStone} />
            <Text style={styles.emptyTitle}>Пока пусто</Text>
            <Text style={styles.emptyText}>Первый камень найдётся под ногами: галька на пляже, скол у тропы. Снимите — и здесь появится карточка.</Text>
            <BigButton label="Сканировать" onPress={toCamera} />
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Здесь появятся камни этого тира. Попробуйте другой фильтр или сходите за новым камнем.</Text>
            <BigButton label="Показать все" variant="secondary" onPress={() => setFilter(null)} />
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
  content: { padding: 16, gap: density.grid, flexGrow: 1 },
  column: { gap: density.grid },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: colors.bg },
  header: { gap: 14, paddingBottom: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  h1: { fontFamily: fonts.serif, fontSize: 27, lineHeight: 30, color: colors.text },
  count: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 14, color: colors.textDim },
  diary: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.divider },
  pressed: { opacity: 0.85 },
  diaryIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.accentTint, alignItems: 'center', justifyContent: 'center' },
  diaryIconMark: { width: 14, height: 14, borderRadius: 3, borderWidth: 1.5, borderColor: colors.accentBright },
  diaryBody: { flex: 1, gap: 2 },
  diaryTitle: { fontFamily: fonts.sansSemi, fontSize: 15, lineHeight: 19, color: colors.text },
  diaryText: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: colors.textMuted },
  chips: { flexDirection: 'row', gap: 7, flexWrap: 'nowrap' },
  spacer: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 52, paddingHorizontal: 30, gap: 14 },
  emptyStone: { width: 52, height: 52, borderRadius: 24, backgroundColor: placeholderStripes.a },
  emptyTitle: { fontFamily: fonts.serif, fontSize: 20, lineHeight: 24, color: colors.text },
  emptyText: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20, color: colors.textMuted, textAlign: 'center', maxWidth: 250 },
});
