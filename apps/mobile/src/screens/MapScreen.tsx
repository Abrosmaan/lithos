// Карта (spec §8, T3.2; DESIGN_SYSTEM.md экран 12): точки сканов цветом тира, тап → карточка, ячейки с
// закрытым дневником подсвечены. react-native-maps: Apple Maps на iOS без ключа; Android требует Google Maps
// API key (см. docs/tasks/T3.2.md). Офлайн — точки из кэша AsyncStorage. Логика загрузки не менялась при рестайле.
// T6.1-E2 (поток E): слой чужих опубликованных находок — маркеры и ячейки по центру geohash-6 (~1,2 км),
// оформлены иначе, чем свои (пунктир, нейтральный серый, без цвета тира): центр ячейки — не место находки,
// маркер должен честно читаться как «примерно здесь, где-то в этой ячейке». Грузится отдельным запросом от
// своих карточек и не должен ронять карту при ошибке (T6.0-fixes-and-social.md §2.2, п.6).
import { TIER_RU, TIERS } from '@lithos/shared';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { Chevron, Note } from '../components/ui';
import { displayName, tierLabel } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { visitedCells, type DiaryRow } from '../lib/diary';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { boundingRegion, fitSpan, groupByLocation, MIN_FIT_SPAN } from '../lib/geo-math';
import { cellPolygon, type LatLng } from '../lib/geohash';
import { loadCards, loadDiary } from '../lib/offline-cache';
import { otherFindPoints, type OtherFindPoint } from '../lib/public-map';
import { listPublicFinds, type PublicFindRow } from '../lib/publish';
import { pluralRu } from '../lib/text';
import type { TabScreenProps } from '../navigation/types';
import { colors, fonts, mapColors, placeholderStripes, radius, tierColor } from '../theme';

type Props = TabScreenProps<'Map'>;

type Point = CardRow & { lat: number; lng: number };

/** Стартовый регион без точек: Черноморское побережье (spec §16 — фокус прототипа). */
const DEFAULT_REGION = { latitude: 44.6, longitude: 37.9, latitudeDelta: 6, longitudeDelta: 6 };
const FIT_PADDING = { top: 80, right: 40, bottom: 160, left: 40 };
/**
 * Чужим находкам на карте нужен весь набор сразу (это точки на карте, а не порционный список под скролл),
 * поэтому листаем страницы, а не берём только первую. Потолок страниц — инженерная защита от бесконечного
 * цикла при большом объёме публикаций, не балансовое число (CLAUDE.md — про score/тиры).
 */
const OTHER_FINDS_PAGE_LIMIT = 100;
const OTHER_FINDS_MAX_PAGES = 10;
/** rgb(154,165,177) = colors.textMuted — нейтральный серый для чужих находок, не занятый другими смыслами легенды. */
const OTHER_CELL_FILL = 'rgba(154,165,177,0.10)';
const OTHER_CELL_STROKE = 'rgba(154,165,177,0.38)';

const hasGeo = (c: CardRow): c is Point => !c.hidden && c.lat !== null && c.lng !== null;

/** Строка листа выбора: общий вид для «несколько своих точек в одной ячейке» и «несколько чужих находок». */
interface SheetRow {
  key: string;
  title: string;
  subtitle: string;
  dotColor: string;
  onSelect: () => void;
}

export function MapScreen({ navigation }: Props) {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [diary, setDiary] = useState<DiaryRow[]>([]);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otherFinds, setOtherFinds] = useState<PublicFindRow[]>([]);
  const mapRef = useRef<MapView>(null);
  const fittedFor = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const seq = useRef(0);
  const insets = useSafeAreaInsets();

  const load = useCallback(async (isFocused: () => boolean = () => true) => {
    const my = ++seq.current;
    const isAlive = () => isFocused() && my === seq.current;
    try {
      const [c, d] = await Promise.all([
        loadCards(),
        loadDiary().catch((e) => { logError('map.diary', e); return { data: [] as DiaryRow[], offline: false }; }),
      ]);
      if (!isAlive()) return;
      setCards(c.data);
      setDiary(d.data);
      setOffline(c.offline);
      setError(null);
    } catch (e) {
      if (!isAlive()) return;
      logError('map', e);
      setError(toUserMessage(e, MSG.loadFailed));
    }
  }, []);

  // Чужие находки — отдельный запрос от своей карты: ошибка (нет сети, RLS) не должна портить свою карту,
  // она просто останется без чужого слоя (T6.0-fixes-and-social.md §2.2, п.6). Листаем до потолка страниц —
  // карте нужны все точки сразу, а не порция под «показать ещё».
  const loadOthers = useCallback(async (isFocused: () => boolean = () => true) => {
    try {
      const all: PublicFindRow[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < OTHER_FINDS_MAX_PAGES; page++) {
        const res = await listPublicFinds({ limit: OTHER_FINDS_PAGE_LIMIT, cursor });
        all.push(...res.items);
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      if (isFocused()) setOtherFinds(all);
    } catch (e) {
      logError('map.others', e);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    void load(() => alive);
    void loadOthers(() => alive);
    return () => { alive = false; };
  }, [load, loadOthers]));

  const points = useMemo(() => (cards ?? []).filter(hasGeo), [cards]);
  const ownCardIds = useMemo(() => new Set((cards ?? []).map((c) => c.id)), [cards]);
  const cells = useMemo(
    () => visitedCells(diary, cards ?? []).flatMap((v) => { const coords = cellPolygon(v.cell_id); return coords ? [{ ...v, coords }] : []; }),
    [diary, cards],
  );
  const completedCount = useMemo(() => cells.filter((c) => c.complete).length, [cells]);
  const partialCount = cells.length - completedCount;
  const initialRegion = useMemo(() => boundingRegion(points) ?? DEFAULT_REGION, [points]);

  // Точки с (почти) совпадающими координатами — один маркер со счётчиком (T6.1-B, 3c); сама группировка
  // живёт в lib/geo-math и покрыта тестами.
  const markerGroups = useMemo(() => groupByLocation(points), [points]);

  // Чужие находки: без гео и свои собственные публикации отсеиваются в otherFindPoints (иначе своя
  // находка нарисовалась бы дважды — своим маркером и «чужим», T6.0-fixes-and-social.md §2.2 п.4/5).
  // Группировка по ячейке использует тот же groupByLocation: центр одной ячейки детерминирован (cellCenter),
  // так что все находки одной ячейки получают одинаковый lat/lng и естественно склеиваются в одну группу.
  const otherPoints = useMemo(() => otherFindPoints(otherFinds, ownCardIds), [otherFinds, ownCardIds]);
  const otherGroups = useMemo(() => groupByLocation(otherPoints), [otherPoints]);
  const otherCells = useMemo(() => {
    const seen = new Set<string>();
    const list: { cell_id: string; coords: LatLng[] }[] = [];
    for (const p of otherPoints) {
      if (seen.has(p.cell_id)) continue;
      seen.add(p.cell_id);
      const coords = cellPolygon(p.cell_id);
      if (coords) list.push({ cell_id: p.cell_id, coords });
    }
    return list;
  }, [otherPoints]);

  const openCard = useCallback((cardId: string) => navigation.navigate('Card', { cardId }), [navigation]);
  const openPublicFind = useCallback((find: PublicFindRow) => navigation.navigate('PublicFind', { find }), [navigation]);

  // Выбор из группы — свой лист, а не Alert: на Android Alert показывает максимум три кнопки и молча
  // отбрасывает остальные, то есть при трёх и более находках в одной точке часть стала бы недоступна без
  // всякого сообщения. Один и тот же лист обслуживает и свои группы, и группы чужих находок (SheetRow — общий
  // вид строки), чтобы не заводить вторую копию Modal/ScrollView ради того же паттерна.
  const [sheet, setSheet] = useState<{ title: string; rows: SheetRow[] } | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  const handleOwnMarkerPress = useCallback((group: Point[]) => {
    if (group.length === 1) { openCard(group[0]!.id); return; }
    setSheet({
      title: `${group.length} ${pluralRu(group.length, 'находка', 'находки', 'находок')} здесь`,
      rows: group.map((c) => ({
        key: c.id,
        title: displayName(c),
        subtitle: tierLabel(c.tier, c.verification),
        dotColor: c.verification === 'pending_review' ? tierColor(null) : tierColor(c.tier),
        onSelect: () => { closeSheet(); openCard(c.id); },
      })),
    });
  }, [openCard, closeSheet]);

  const handleOtherMarkerPress = useCallback((group: OtherFindPoint[]) => {
    if (group.length === 1) { openPublicFind(group[0]!); return; }
    setSheet({
      title: `${group.length} ${pluralRu(group.length, 'чужая находка', 'чужие находки', 'чужих находок')} здесь`,
      rows: group.map((f) => ({
        key: f.id,
        title: displayName(f),
        subtitle: `${tierLabel(f.tier)} · ${f.author_name ?? 'Без имени'}`,
        dotColor: tierColor(f.tier),
        onSelect: () => { closeSheet(); openPublicFind(f); },
      })),
    });
  }, [openPublicFind, closeSheet]);

  // Подгоняем карту под свои точки, когда карта готова и набор изменился (первая загрузка, новый скан);
  // чужие находки на охват карты намеренно не влияют — ориентир всегда своя коллекция, а не чужие публикации,
  // и логику зума (T6.1-B, дефект 3a) незачем усложнять вторым источником точек.
  const pointsKey = useMemo(() => points.map((p) => p.id).sort().join(','), [points]);
  useEffect(() => {
    if (!ready || points.length === 0 || !mapRef.current || fittedFor.current === pointsKey) return;
    const animated = fittedFor.current !== null;
    fittedFor.current = pointsKey;
    if (points.length === 1 || fitSpan(points) < MIN_FIT_SPAN) {
      const r = boundingRegion(points);
      if (r) mapRef.current.animateToRegion(r, animated ? 350 : 0);
    } else {
      mapRef.current.fitToCoordinates(points.map((p) => ({ latitude: p.lat, longitude: p.lng })), { edgePadding: FIT_PADDING, animated });
    }
  }, [ready, points, pointsKey]);

  if (cards === null && error) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error}</Text>
        <BigButton label="Обновить" onPress={() => { void load(); }} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onMapReady={() => setReady(true)}
        showsUserLocation
        showsCompass={false}
        userInterfaceStyle="dark"
        toolbarEnabled={false}
      >
        {cells.map((c) => (
          <Polygon
            key={c.cell_id}
            coordinates={c.coords}
            fillColor={c.complete ? mapColors.cellFill : colors.accentTint}
            strokeColor={c.complete ? mapColors.cellStroke : colors.accentBorder}
            strokeWidth={2}
            lineDashPattern={c.complete ? undefined : [6, 4]}
          />
        ))}
        {otherCells.map((c) => (
          <Polygon
            key={`other-${c.cell_id}`}
            coordinates={c.coords}
            fillColor={OTHER_CELL_FILL}
            strokeColor={OTHER_CELL_STROKE}
            strokeWidth={1.5}
            lineDashPattern={[3, 5]}
          />
        ))}
        {markerGroups.map((group) => {
          const first = group[0]!;
          const count = group.length;
          return (
            <Marker
              key={`own-${group.map((g) => g.id).join('+')}`}
              coordinate={{ latitude: first.lat, longitude: first.lng }}
              title={count > 1 ? `${count} ${pluralRu(count, 'находка', 'находки', 'находок')}` : displayName(first)}
              description={count === 1 ? tierLabel(first.tier, first.verification) : undefined}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => handleOwnMarkerPress(group)}
            >
              <View style={styles.markerRing}>
                <View style={[styles.dot, { backgroundColor: first.verification === 'pending_review' ? tierColor(null) : tierColor(first.tier) }]}>
                  {count > 1 ? (
                    <Text style={styles.dotMark}>{count}</Text>
                  ) : (
                    first.verification === 'pending_review' && <Text style={styles.dotMark}>?</Text>
                  )}
                </View>
              </View>
            </Marker>
          );
        })}
        {otherGroups.map((group) => {
          const first = group[0]!;
          const count = group.length;
          return (
            <Marker
              key={`other-${group.map((g) => g.id).join('+')}`}
              coordinate={{ latitude: first.lat, longitude: first.lng }}
              title={`${count} ${pluralRu(count, 'чужая находка', 'чужие находки', 'чужих находок')}`}
              description="Примерное место — центр ячейки, не точная точка находки"
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => handleOtherMarkerPress(group)}
            >
              <View style={styles.otherMarker}>
                <Text style={styles.otherMarkerText}>{count}</Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

      <Modal visible={sheet !== null} transparent animationType="fade" onRequestClose={closeSheet}>
        <Pressable
          style={styles.sheetBackdrop}
          onPress={closeSheet}
          accessibilityRole="button"
          accessibilityLabel="Закрыть выбор находки"
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetGrip} />
          <Text style={styles.sheetTitle}>{sheet?.title ?? ''}</Text>
          <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent} showsVerticalScrollIndicator={false}>
            {(sheet?.rows ?? []).map((r) => (
              <Pressable
                key={r.key}
                onPress={r.onSelect}
                accessibilityRole="button"
                style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
              >
                <View style={[styles.legendDot, { backgroundColor: r.dotColor }]} />
                <View style={styles.sheetRowBody}>
                  <Text style={styles.sheetName} numberOfLines={1}>{r.title}</Text>
                  <Text style={styles.legendText}>{r.subtitle}</Text>
                </View>
                <Chevron />
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={closeSheet} accessibilityRole="button" style={styles.sheetCancel}>
            <Text style={styles.link}>Отмена</Text>
          </Pressable>
        </View>
      </Modal>

      {(offline || (error && cards)) && (
        <View style={[styles.banner, { top: insets.top + 10 }]}>
          <Note tone="neutral">{offline ? 'Нет связи — показаны сохранённые точки.' : error}</Note>
        </View>
      )}

      <View style={[styles.legend, { bottom: insets.bottom > 0 ? 10 : 16 }]}>
        {cards === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : points.length === 0 && otherGroups.length === 0 ? (
          <View style={styles.legendEmpty}>
            <View style={styles.legendStone} />
            <Text style={styles.legendTitle}>Пока нет точек</Text>
            <Text style={styles.muted}>Отсканируйте камень с геопозицией — он появится на карте.</Text>
            <Pressable onPress={() => navigation.navigate('Tabs', { screen: 'Camera' }, { pop: true })} accessibilityRole="button">
              <Text style={styles.link}>Сканировать</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.legendCount}>
              {points.length} {pluralRu(points.length, 'точка', 'точки', 'точек')}
              {completedCount > 0 ? ` · ${completedCount} ${pluralRu(completedCount, 'ячейка закрыта', 'ячейки закрыты', 'ячеек закрыто')}` : ''}
              {partialCount > 0 ? ` · ${partialCount} ${pluralRu(partialCount, 'ячейка посещена', 'ячейки посещены', 'ячеек посещено')}` : ''}
              {otherPoints.length > 0 ? ` · ${otherPoints.length} ${pluralRu(otherPoints.length, 'чужая находка', 'чужие находки', 'чужих находок')}` : ''}
            </Text>
            <View style={styles.legendRow}>
              {[...TIERS].reverse().map((t) => (
                <View key={t} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: tierColor(t) }]} />
                  <Text style={styles.legendText}>{TIER_RU[t]}</Text>
                </View>
              ))}
              {completedCount > 0 && (
                <View style={styles.legendItem}>
                  <View style={styles.legendSquare} />
                  <Text style={styles.legendText}>дневник закрыт</Text>
                </View>
              )}
              {partialCount > 0 && (
                <View style={styles.legendItem}>
                  <View style={styles.legendSquareDim} />
                  <Text style={styles.legendText}>есть находки</Text>
                </View>
              )}
              {otherGroups.length > 0 && (
                <View style={styles.legendItem}>
                  <View style={styles.otherMarkerLegend} />
                  <Text style={styles.legendText}>чужие (примерно)</Text>
                </View>
              )}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  muted: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19, color: colors.textMuted },
  markerRing: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dot: { width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  dotMark: { fontFamily: fonts.monoBold, fontSize: 9, lineHeight: 10, color: colors.bg },
  // Чужой маркер: пунктирная рамка вместо заливки цветом тира — тот же язык, что у «посещённых» ячеек
  // (пунктир = приблизительно/не полностью своё). Нейтральный серый — золотой и бирюзовый уже заняты
  // своими значениями в легенде (дневник закрыт / есть находки).
  otherMarker: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.textMuted, backgroundColor: 'rgba(154,165,177,0.22)', alignItems: 'center', justifyContent: 'center' },
  otherMarkerText: { fontFamily: fonts.monoBold, fontSize: 9, lineHeight: 10, color: colors.text },
  otherMarkerLegend: { width: 9, height: 9, borderRadius: 4.5, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.textMuted, backgroundColor: 'rgba(154,165,177,0.22)' },
  banner: { position: 'absolute', left: 16, right: 16 },
  legend: { position: 'absolute', left: 16, right: 16, backgroundColor: 'rgba(22,28,36,0.94)', borderRadius: radius.md, padding: 16, gap: 11, borderWidth: 1, borderColor: colors.divider },
  legendEmpty: { gap: 8, alignItems: 'flex-start' },
  legendStone: { width: 34, height: 34, borderRadius: 16, backgroundColor: placeholderStripes.a },
  legendTitle: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 20, color: colors.text },
  legendCount: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 16, color: colors.chipText },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 4.5 },
  legendSquare: { width: 9, height: 9, backgroundColor: mapColors.cellFill, borderWidth: 1, borderColor: mapColors.cellStroke },
  legendSquareDim: { width: 9, height: 9, backgroundColor: colors.accentTint, borderWidth: 1, borderColor: colors.accentBorder, borderStyle: 'dashed' },
  legendText: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 14, color: colors.textMuted },
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,15,20,0.6)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '70%', backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderTopWidth: 1, borderColor: colors.divider, paddingTop: 10, paddingHorizontal: 16, gap: 10 },
  sheetGrip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 22, color: colors.text },
  sheetList: { flexGrow: 0 },
  sheetListContent: { gap: 8, paddingBottom: 4 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, paddingHorizontal: 13, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.divider },
  sheetRowPressed: { opacity: 0.8 },
  sheetRowBody: { flex: 1, gap: 2 },
  sheetName: { fontFamily: fonts.sansSemi, fontSize: 14.5, lineHeight: 18, color: colors.text },
  sheetCancel: { alignSelf: 'center', paddingVertical: 12 },
  link: { fontFamily: fonts.sansSemi, fontSize: 14, lineHeight: 18, color: colors.accentBright },
});
