// Дневник локации (spec §8, T3.1; DESIGN_SYSTEM.md экран 11): ожидаемые породы ячейки geohash-6
// (lithos.diary.expected, а до первого скана — geo_cache.expected_rocks) и найденные (diary.found ∪ карточки
// в ячейке). Прогресс N из M, значок при 100 %. Логика загрузки/резолва ячейки не менялась при рестайле.
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardTile } from '../components/CardTile';
import { BigButton } from '../components/BigButton';
import { PublicFindTile } from '../components/PublicFindTile';
import { Note, SectionLabel } from '../components/ui';
import { rockClassRu } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { fetchDiaryCell, fetchExpectedRocks, listCardsInCell } from '../lib/cards';
import { diaryProgress, type DiaryProgress } from '../lib/diary';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { cellCenter, encodeGeohash } from '../lib/geohash';
import { requestGeoFix } from '../lib/location';
import { loadCards, readCachedCards } from '../lib/offline-cache';
import { fetchPrimaryPhotoUrls } from '../lib/photo-urls';
import { fallbackPlaceName, placeNameForCell } from '../lib/place-name';
import { fetchPublicPhotoUrl, listPublicFinds, type PublicFindRow } from '../lib/publish';
import type { RootScreenProps } from '../navigation/types';
import { colors, density, fonts, radius, tierColors } from '../theme';

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
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  // «Здесь находили другие» (T6.1-E2): отдельное состояние и отдельная загрузка от своих карточек выше —
  // ошибка сети здесь не должна портить остальной экран (T6.0-fixes-and-social.md §2.2, п.6). null — ещё
  // не загружено (спиннер), [] после загрузки — «никто не публиковал» либо ошибка (othersError не null).
  const [others, setOthers] = useState<PublicFindRow[] | null>(null);
  const [othersCursor, setOthersCursor] = useState<string | null>(null);
  const [othersMore, setOthersMore] = useState(false);
  const [othersError, setOthersError] = useState<string | null>(null);
  const [otherUrls, setOtherUrls] = useState<Map<string, string>>(new Map());
  const insets = useSafeAreaInsets();
  const seq = useRef(0);
  // Для догрузки страниц: актуальная ячейка и признак живого экрана — сравниваются после await.
  const cellIdRef = useRef<string | null>(null);
  const othersAlive = useRef(true);
  useEffect(() => () => { othersAlive.current = false; }, []);

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
      const shown = cards.filter((c) => !c.hidden);
      if (shown.length > 0) {
        const photos = await fetchPrimaryPhotoUrls(shown.map((c) => c.scan_id));
        if (isAlive()) setUrls(photos);
      }
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

  // Топоним ячейки (T6.0 §4a): гонка на смену ячейки (гео ↔ карточка) гасится через alive-замыкание,
  // сброс на fallback при смене cellId — чтобы не показать имя чужой ячейки, пока грузится новое.
  const currentCellId = data?.cellId;
  useEffect(() => {
    if (!currentCellId) return;
    let alive = true;
    setPlaceName(null);
    void placeNameForCell(currentCellId).then((name) => { if (alive) setPlaceName(name); });
    return () => { alive = false; };
  }, [currentCellId]);

  // «Здесь находили другие» (T6.0-fixes-and-social.md §2.3): агрегат по ячейке, отдельный запрос от
  // fetchDiaryCell/listCardsInCell выше — падает тихо, дневник остаётся рабочим и без чужого раздела.
  useEffect(() => {
    if (!currentCellId) return;
    let alive = true;
    cellIdRef.current = currentCellId;
    setOthers(null);
    setOthersCursor(null);
    setOthersError(null);
    setOtherUrls(new Map());
    void listPublicFinds({ cellId: currentCellId })
      .then((page) => { if (!alive) return; setOthers(page.items); setOthersCursor(page.nextCursor); })
      .catch((e) => {
        if (!alive) return;
        logError('diary.others', e);
        setOthers([]);
        setOthersError(toUserMessage(e, MSG.loadFailed));
      });
    return () => { alive = false; };
  }, [currentCellId]);

  // Фото чужих находок — по одному (fetchPublicPhotoUrl не бросает, сам возвращает null при отказе).
  useEffect(() => {
    if (!others || others.length === 0) return;
    let alive = true;
    void Promise.all(others.map(async (f) => [f.id, await fetchPublicPhotoUrl(f.id)] as const)).then((pairs) => {
      if (!alive) return;
      setOtherUrls((prev) => {
        const next = new Map(prev);
        for (const [id, url] of pairs) if (url) next.set(id, url);
        return next;
      });
    });
    return () => { alive = false; };
  }, [others]);

  const loadMoreOthers = async () => {
    if (!currentCellId || !othersCursor || othersMore) return;
    // Ячейка может смениться, пока летит запрос (экран пересчитывает её на каждом фокусе), а экран —
    // размонтироваться. Дописывать страницу старой ячейки в список новой нельзя, поэтому ячейка
    // запоминается до запроса и сверяется после.
    const cellId = currentCellId;
    setOthersMore(true);
    try {
      const page = await listPublicFinds({ cellId, cursor: othersCursor });
      if (!othersAlive.current || cellIdRef.current !== cellId) return;
      setOthers((prev) => [...(prev ?? []), ...page.items]);
      setOthersCursor(page.nextCursor);
    } catch (e) {
      logError('diary.others.more', e); // первая страница уже показана — тихо не добавляем следующую
    } finally {
      if (othersAlive.current) setOthersMore(false);
    }
  };

  const toCamera = () => navigation.navigate('Tabs', { screen: 'Camera' }, { pop: true });
  const pad = { paddingBottom: insets.bottom + 30 };

  if (noGeo) {
    return (
      <View style={[styles.center, pad]}>
        <Text style={styles.h1}>Нет геопозиции</Text>
        <Text style={styles.muted}>Дневник ведётся по ячейке, где вы находитесь. Разрешите геопозицию в настройках или отсканируйте камень с гео — тогда появится дневник его места.</Text>
        <BigButton label="Попробовать снова" onPress={() => { void load(); }} />
        <BigButton label="Сканировать" variant="secondary" onPress={toCamera} />
      </View>
    );
  }
  if (error && !data) {
    return (
      <View style={[styles.center, pad]}>
        <Text style={styles.muted}>{error}</Text>
        <BigButton label="Обновить" onPress={() => { void load(); }} />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={[styles.center, pad]}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.muted}>Определяем место…</Text>
      </View>
    );
  }

  const { cellId, source, progress, cards } = data;
  const center = cellCenter(cellId);
  const shownCards = cards.filter((c) => !c.hidden); // found считается с родителями после раскола, список — без них
  const pct = progress.total > 0 ? progress.foundCount / progress.total : 0;
  // Свои же публикации не должны показываться в «Здесь находили другие» — это чужой раздел; свои находки
  // этой ячейки уже видны выше, в «Находки в ячейке» (T6.0-fixes-and-social.md §2.2, п.4, применено и здесь).
  const otherItems = others ? others.filter((f) => !cards.some((c) => c.id === f.id)) : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, pad]}>
      {error && (
        <Pressable onPress={() => { void load(); }} accessibilityRole="button">
          <Note tone="danger">{error} Нажмите, чтобы обновить.</Note>
        </Pressable>
      )}

      <View style={[styles.hero, progress.complete && styles.heroComplete]}>
        <View style={styles.heroHead}>
          <Text style={styles.cell} numberOfLines={2}>{placeName ?? fallbackPlaceName(cellId)}</Text>
          <Text style={styles.coords}>{center ? `${cellId} · ${center.latitude.toFixed(3)}, ${center.longitude.toFixed(3)}` : cellId}</Text>
        </View>
        <Text style={styles.source}>{SOURCE_RU[source]}</Text>
        {progress.total > 0 ? (
          <>
            <View style={styles.progressRow}>
              <Text style={styles.progressN}>{progress.foundCount}</Text>
              <Text style={styles.progressOf}>из {progress.total} ожидаемых пород</Text>
            </View>
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
        <View style={styles.section}>
          <SectionLabel>Ожидаемые породы</SectionLabel>
          {progress.items.map((i) => (
            <View key={i.rock_class} style={[styles.item, i.found ? styles.itemFound : styles.itemPending]}>
              <View style={[styles.mark, i.found ? styles.markOn : styles.markOff]}>
                {i.found && <View style={styles.markCheck} />}
              </View>
              <Text style={[styles.itemText, i.found && styles.itemTextFound]}>{rockClassRu(i.rock_class)}</Text>
              <Text style={styles.itemNote}>{i.found ? 'найдено' : 'ожидается'}</Text>
            </View>
          ))}
        </View>
      )}

      {progress.extra.length > 0 && (
        <View style={styles.section}>
          <SectionLabel>Сверх списка</SectionLabel>
          {progress.extra.map((r) => (
            <View key={r} style={styles.extra}>
              <Text style={styles.extraName}>{rockClassRu(r)}</Text>
              <Text style={styles.extraNote}>не ожидался здесь — странник или редкость</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <SectionLabel>Находки в ячейке · {shownCards.length}</SectionLabel>
        {shownCards.length === 0 ? (
          <Text style={styles.muted}>Ещё ничего не найдено.</Text>
        ) : (
          <View style={styles.grid}>
            {shownCards.map((c) => (
              <View key={c.id} style={styles.gridItem}>
                <CardTile card={c} size="sm" photoUrl={urls.get(c.scan_id)} onPress={() => navigation.push('Card', { cardId: c.id })} />
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <SectionLabel>Здесь находили другие</SectionLabel>
        {otherItems === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : othersError && otherItems.length === 0 ? (
          <Text style={styles.muted}>{othersError}</Text>
        ) : otherItems.length === 0 ? (
          <Text style={styles.muted}>Здесь пока никто ничего не публиковал.</Text>
        ) : (
          <>
            <View style={styles.grid}>
              {otherItems.map((f) => (
                <View key={f.id} style={styles.gridItem}>
                  <PublicFindTile find={f} photoUrl={otherUrls.get(f.id)} onPress={() => navigation.navigate('PublicFind', { find: f })} />
                </View>
              ))}
            </View>
            {othersCursor && (
              <Pressable onPress={() => { void loadMoreOthers(); }} disabled={othersMore} accessibilityRole="button">
                <Text style={styles.link}>{othersMore ? 'Загрузка…' : 'Показать ещё'}</Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      <BigButton label="Сканировать здесь" onPress={toCamera} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: density.gap },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  h1: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 27, color: colors.text, textAlign: 'center' },
  muted: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20, color: colors.textMuted, textAlign: 'center' },
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider, padding: 17, gap: 13 },
  heroComplete: { borderColor: tierColors.legendary },
  heroHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cell: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 27, color: colors.text, flex: 1 },
  coords: { fontFamily: fonts.monoRegular, fontSize: 11, lineHeight: 14, color: colors.textDim },
  source: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: colors.textMuted },
  progressRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  progressN: { fontFamily: fonts.monoBold, fontSize: 26, lineHeight: 28, color: colors.text },
  progressOf: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 18, color: colors.textMuted },
  bar: { height: 8, borderRadius: radius.full, backgroundColor: colors.track, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radius.full, backgroundColor: colors.accent },
  barComplete: { backgroundColor: tierColors.legendary },
  badge: { alignSelf: 'flex-start', backgroundColor: tierColors.legendary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full },
  badgeText: { fontFamily: fonts.sansBold, fontSize: 13.5, color: '#1a1400' },
  link: { fontFamily: fonts.sansSemi, fontSize: 13.5, lineHeight: 18, color: colors.accentBright },
  section: { gap: 9 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingHorizontal: 13, borderRadius: radius.md, borderWidth: 1 },
  itemFound: { backgroundColor: colors.accentTint, borderColor: colors.accentBorder },
  itemPending: { backgroundColor: colors.surface, borderColor: colors.divider },
  mark: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  markOn: { borderColor: colors.accentBright, backgroundColor: colors.accent },
  markOff: { borderColor: 'rgba(242,244,246,0.2)' },
  markCheck: { width: 7, height: 4, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.accentText, transform: [{ rotate: '-45deg' }], marginTop: -2 },
  itemText: { flex: 1, fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 19, color: colors.textMuted },
  itemTextFound: { color: colors.text },
  itemNote: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, color: colors.textDim },
  extra: { padding: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accentBorder, gap: 4 },
  extraName: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 19, color: colors.text },
  extraNote: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: density.grid },
  gridItem: { width: '48%', flexGrow: 1 },
});
