// Дневник локации (spec §8, T3.1): ожидаемые породы ячейки geohash-6 (lithos.diary.expected, а до первого скана —
// geo_cache.expected_rocks) и найденные (diary.found ∪ карточки в ячейке). Прогресс N из M, значок при 100 %.
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { Line, Section } from '../components/Section';
import { TierBadge } from '../components/TierBadge';
import { displayName, formatDateRu, rockClassRu } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { fetchDiaryCell, fetchExpectedRocks, listCardsInCell } from '../lib/cards';
import { diaryProgress, type DiaryProgress } from '../lib/diary';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { cellCenter, encodeGeohash } from '../lib/geohash';
import { requestGeoFix } from '../lib/location';
import { loadCards, readCachedCards } from '../lib/offline-cache';
import type { RootScreenProps } from '../navigation/types';
import { colors, radius, spacing, tierColors } from '../theme';

type Props = RootScreenProps<'Diary'>;

type CellSource = 'card' | 'geo' | 'last';

interface Loaded {
  cellId: string;
  source: CellSource;
  progress: DiaryProgress;
  cards: CardRow[];
}

const SOURCE_RU: Record<CellSource, string> = {
  card: 'ячейка карточки',
  geo: 'ваше текущее место',
  last: 'ячейка последней находки — геопозиция недоступна',
};

export function DiaryScreen({ navigation, route }: Props) {
  const paramCell = route.params?.cellId;
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noGeo, setNoGeo] = useState(false);
  const [useGeo, setUseGeo] = useState(!paramCell);
  const insets = useSafeAreaInsets();
  const seq = useRef(0);

  const resolveCell = useCallback(async (): Promise<{ cellId: string; source: CellSource } | null> => {
    if (paramCell && !useGeo) return { cellId: paramCell, source: 'card' };
    const geo = await requestGeoFix();
    if (geo.fix) return { cellId: encodeGeohash(geo.fix.lat, geo.fix.lng), source: 'geo' };
    // Без гео — ячейка последней находки: сеть (с обновлением кэша), офлайн — кэш.
    const cards = await loadCards().then((r) => r.data).catch(() => readCachedCards());
    const last = cards?.find((c) => c.cell_id);
    return last?.cell_id ? { cellId: last.cell_id, source: 'last' } : null;
  }, [paramCell, useGeo]);

  const load = useCallback(async (isFocused: () => boolean = () => true) => {
    const my = ++seq.current;
    const isAlive = () => isFocused() && my === seq.current;
    try {
      const cell = await resolveCell();
      if (!isAlive()) return;
      if (!cell) { if (!data) setNoGeo(true); setError(null); return; } // уже показанный дневник не затираем
      setNoGeo(false);
      const [diary, cards] = await Promise.all([fetchDiaryCell(cell.cellId), listCardsInCell(cell.cellId)]);
      const expected = diary && diary.expected.length > 0 ? diary.expected : await fetchExpectedRocks(cell.cellId);
      if (!isAlive()) return;
      setData({ ...cell, cards, progress: diaryProgress({ expected, found: diary?.found ?? [], cards }) });
      setError(null);
    } catch (e) {
      if (!isAlive()) return;
      logError('diary', e);
      setError(toUserMessage(e, MSG.loadFailed));
    }
  }, [resolveCell, data]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    void load(() => alive);
    return () => { alive = false; };
  }, [load]));

  const toCamera = () => navigation.navigate('Tabs', { screen: 'Camera' }, { pop: true });

  if (noGeo) {
    return (
      <View style={styles.center}>
        <Text style={styles.h1}>Нет геопозиции</Text>
        <Text style={styles.muted}>Дневник ведётся по ячейке, где вы находитесь. Разрешите геопозицию в настройках или отсканируйте камень с гео — тогда появится дневник его места.</Text>
        <BigButton label="Попробовать снова" onPress={() => { void load(); }} style={styles.stretch} />
        <BigButton label="Сканировать" variant="secondary" onPress={toCamera} style={styles.stretch} />
      </View>
    );
  }
  if (error && !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error}</Text>
        <BigButton label="Обновить" onPress={() => { void load(); }} style={styles.stretch} />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.muted}>Определяем место…</Text>
      </View>
    );
  }

  const { cellId, source, progress, cards } = data;
  const center = cellCenter(cellId);
  const shownCards = cards.filter((c) => !c.hidden); // found считается с родителями после раскола, список — без них
  const pct = progress.total > 0 ? progress.foundCount / progress.total : 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
      {error && (
        <Pressable onPress={() => { void load(); }} accessibilityRole="button" style={styles.errorBanner}>
          <Text style={styles.errorText}>{error} Нажмите, чтобы обновить.</Text>
        </Pressable>
      )}

      <View style={[styles.hero, progress.complete && styles.heroComplete]}>
        <Text style={styles.cell}>Ячейка {cellId}{center ? ` · ${center.latitude.toFixed(3)}, ${center.longitude.toFixed(3)}` : ''}</Text>
        <Text style={styles.source}>{SOURCE_RU[source]}</Text>
        {progress.total > 0 ? (
          <>
            <Text style={styles.progress}>{progress.foundCount} из {progress.total}</Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }, progress.complete && styles.barComplete]} />
            </View>
            {progress.complete ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>🏅 Дневник закрыт</Text>
              </View>
            ) : (
              <Text style={styles.muted}>Найдите все ожидаемые породы — получите значок.</Text>
            )}
          </>
        ) : (
          <Text style={styles.muted}>Для этой ячейки ещё нет данных о геологии. Отсканируйте камень здесь — список ожидаемых пород появится.</Text>
        )}
        {paramCell && (
          <Pressable onPress={() => setUseGeo((v) => !v)} accessibilityRole="button">
            <Text style={styles.link}>{useGeo ? 'Показать ячейку карточки' : 'Показать моё текущее место'}</Text>
          </Pressable>
        )}
      </View>

      {progress.items.length > 0 && (
        <Section title="Ожидаются здесь">
          {progress.items.map((i) => (
            <View key={i.rock_class} style={styles.item}>
              <Text style={[styles.check, i.found && styles.checkOn]}>{i.found ? '✓' : '○'}</Text>
              <Text style={[styles.itemText, i.found && styles.itemFound]}>{rockClassRu(i.rock_class)}</Text>
            </View>
          ))}
        </Section>
      )}

      {progress.extra.length > 0 && (
        <Section title="Сверх списка">
          {progress.extra.map((r) => <Line key={r}>{rockClassRu(r)} — не ожидался здесь (странник или редкость)</Line>)}
        </Section>
      )}

      <Section title={`Находки в ячейке · ${shownCards.length}`}>
        {shownCards.length === 0 && <Line muted>Ещё ничего не найдено.</Line>}
        {shownCards.map((c) => (
          <Pressable key={c.id} onPress={() => navigation.push('Card', { cardId: c.id })} accessibilityRole="button" style={({ pressed }) => [styles.cardRow, pressed && styles.pressed]}>
            <View style={styles.cardBody}>
              <Text style={styles.cardName} numberOfLines={1}>{displayName(c)}</Text>
              <Text style={styles.cardSub} numberOfLines={1}>{rockClassRu(c.rock_class)}{formatDateRu(c.created_at) ? ` · ${formatDateRu(c.created_at)}` : ''}</Text>
            </View>
            <TierBadge tier={c.tier} verification={c.verification} />
          </Pressable>
        ))}
      </Section>

      <BigButton label="Сканировать здесь" onPress={toCamera} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  stretch: { alignSelf: 'stretch' },
  h1: { color: colors.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorBanner: { backgroundColor: colors.warning, borderRadius: radius.md, padding: spacing.md },
  errorText: { color: '#fff', fontSize: 15 },
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm, alignItems: 'center' },
  heroComplete: { borderColor: tierColors.legendary },
  cell: { color: colors.text, fontSize: 15, fontWeight: '600' },
  source: { color: colors.textMuted, fontSize: 13 },
  progress: { color: colors.text, fontSize: 40, fontWeight: '800', lineHeight: 46 },
  bar: { alignSelf: 'stretch', height: 10, borderRadius: radius.full, backgroundColor: colors.surfaceActive, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.full },
  barComplete: { backgroundColor: tierColors.legendary },
  badge: { backgroundColor: tierColors.legendary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full },
  badgeText: { color: '#1a1400', fontSize: 15, fontWeight: '800' },
  link: { color: '#7cc4ff', fontSize: 15, paddingTop: spacing.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  check: { color: colors.textMuted, fontSize: 20, width: 26, textAlign: 'center' },
  checkOn: { color: '#5ccb8a' },
  itemText: { color: colors.textMuted, fontSize: 17 },
  itemFound: { color: colors.text, fontWeight: '600' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pressed: { opacity: 0.8 },
  cardBody: { flex: 1, gap: 2 },
  cardName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  cardSub: { color: colors.textMuted, fontSize: 13 },
});
