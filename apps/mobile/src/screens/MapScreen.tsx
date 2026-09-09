// Карта (spec §8, T3.2; DESIGN_SYSTEM.md экран 12): точки сканов цветом тира, тап → карточка, ячейки с
// закрытым дневником подсвечены. react-native-maps: Apple Maps на iOS без ключа; Android требует Google Maps
// API key (см. docs/tasks/T3.2.md). Офлайн — точки из кэша AsyncStorage. Логика загрузки не менялась при рестайле.
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
import { cellPolygon } from '../lib/geohash';
import { loadCards, loadDiary } from '../lib/offline-cache';
import { pluralRu } from '../lib/text';
import type { TabScreenProps } from '../navigation/types';
import { colors, fonts, mapColors, placeholderStripes, radius, tierColor } from '../theme';

type Props = TabScreenProps<'Map'>;

type Point = CardRow & { lat: number; lng: number };

/** Стартовый регион без точек: Черноморское побережье (spec §16 — фокус прототипа). */
const DEFAULT_REGION = { latitude: 44.6, longitude: 37.9, latitudeDelta: 6, longitudeDelta: 6 };
const FIT_PADDING = { top: 80, right: 40, bottom: 160, left: 40 };

const hasGeo = (c: CardRow): c is Point => !c.hidden && c.lat !== null && c.lng !== null;

export function MapScreen({ navigation }: Props) {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [diary, setDiary] = useState<DiaryRow[]>([]);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useFocusEffect(useCallback(() => {
    let alive = true;
    void load(() => alive);
    return () => { alive = false; };
  }, [load]));

  const points = useMemo(() => (cards ?? []).filter(hasGeo), [cards]);
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

  const openCard = useCallback((cardId: string) => navigation.navigate('Card', { cardId }), [navigation]);
  // Выбор из группы — свой лист, а не Alert: на Android Alert показывает максимум три кнопки и молча
  // отбрасывает остальные, то есть при трёх и более сканах в одной точке часть находок стала бы недоступна.
  const [picker, setPicker] = useState<Point[] | null>(null);
  const handleMarkerPress = useCallback((group: Point[]) => {
    if (group.length === 1) { openCard(group[0]!.id); return; }
    setPicker(group);
  }, [openCard]);
  const pickCard = useCallback((cardId: string) => { setPicker(null); openCard(cardId); }, [openCard]);

  // Подгоняем карту под точки, когда карта готова и набор точек изменился (первая загрузка, новый скан);
  // при простом возврате на вкладку с тем же набором — не дёргаем. `fitToCoordinates` не имеет нижней границы
  // охвата: на вырожденном наборе (одна точка / несколько точек в одном месте, дефект 3a) он уводит зум туда,
  // где тайлов не существует — вместо него используем `boundingRegion`, у которого есть minDelta.
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
        {markerGroups.map((group) => {
          const first = group[0]!;
          const count = group.length;
          return (
            <Marker
              key={group.map((g) => g.id).join('+')}
              coordinate={{ latitude: first.lat, longitude: first.lng }}
              title={count > 1 ? `${count} ${pluralRu(count, 'находка', 'находки', 'находок')}` : displayName(first)}
              description={count === 1 ? tierLabel(first.tier, first.verification) : undefined}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => handleMarkerPress(group)}
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
      </MapView>

      <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setPicker(null)}
          accessibilityRole="button"
          accessibilityLabel="Закрыть выбор находки"
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetGrip} />
          <Text style={styles.sheetTitle}>
            {picker ? `${picker.length} ${pluralRu(picker.length, 'находка', 'находки', 'находок')} здесь` : ''}
          </Text>
          <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent} showsVerticalScrollIndicator={false}>
            {(picker ?? []).map((c) => (
              <Pressable
                key={c.id}
                onPress={() => pickCard(c.id)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
              >
                <View style={[styles.legendDot, { backgroundColor: c.verification === 'pending_review' ? tierColor(null) : tierColor(c.tier) }]} />
                <View style={styles.sheetRowBody}>
                  <Text style={styles.sheetName} numberOfLines={1}>{displayName(c)}</Text>
                  <Text style={styles.legendText}>{tierLabel(c.tier, c.verification)}</Text>
                </View>
                <Chevron />
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={() => setPicker(null)} accessibilityRole="button" style={styles.sheetCancel}>
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
        ) : points.length === 0 ? (
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
