// Карта (spec §8, T3.2; DESIGN_SYSTEM.md экран 12): точки сканов цветом тира, тап → карточка, ячейки с
// закрытым дневником подсвечены. react-native-maps: Apple Maps на iOS без ключа; Android требует Google Maps
// API key (см. docs/tasks/T3.2.md). Офлайн — точки из кэша AsyncStorage. Логика загрузки не менялась при рестайле.
import { TIER_RU, TIERS } from '@lithos/shared';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { Note } from '../components/ui';
import { displayName, tierLabel } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { completedCells, type DiaryRow } from '../lib/diary';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { boundingRegion } from '../lib/geo-math';
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
  const polygons = useMemo(
    () => completedCells(diary, cards ?? []).flatMap((cell) => { const coords = cellPolygon(cell); return coords ? [{ cell, coords }] : []; }),
    [diary, cards],
  );
  const initialRegion = useMemo(() => boundingRegion(points) ?? DEFAULT_REGION, [points]);

  // Подгоняем карту под точки, когда карта готова и набор точек изменился (первая загрузка, новый скан);
  // при простом возврате на вкладку с тем же набором — не дёргаем.
  const pointsKey = useMemo(() => points.map((p) => p.id).sort().join(','), [points]);
  useEffect(() => {
    if (!ready || points.length === 0 || !mapRef.current || fittedFor.current === pointsKey) return;
    const animated = fittedFor.current !== null;
    fittedFor.current = pointsKey;
    mapRef.current.fitToCoordinates(points.map((p) => ({ latitude: p.lat, longitude: p.lng })), { edgePadding: FIT_PADDING, animated });
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
        {polygons.map((p) => (
          <Polygon key={p.cell} coordinates={p.coords} fillColor={mapColors.cellFill} strokeColor={mapColors.cellStroke} strokeWidth={2} />
        ))}
        {points.map((c) => (
          <Marker
            key={c.id}
            identifier={c.id}
            coordinate={{ latitude: c.lat, longitude: c.lng }}
            title={displayName(c)}
            description={tierLabel(c.tier, c.verification)}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            onPress={() => navigation.navigate('Card', { cardId: c.id })}
          >
            <View style={styles.markerRing}>
              <View style={[styles.dot, { backgroundColor: c.verification === 'pending_review' ? tierColor(null) : tierColor(c.tier) }]}>
                {c.verification === 'pending_review' && <Text style={styles.dotMark}>?</Text>}
              </View>
            </View>
          </Marker>
        ))}
      </MapView>

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
              {polygons.length > 0 ? ` · ${polygons.length} ${pluralRu(polygons.length, 'ячейка закрыта', 'ячейки закрыты', 'ячеек закрыто')}` : ''}
            </Text>
            <View style={styles.legendRow}>
              {[...TIERS].reverse().map((t) => (
                <View key={t} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: tierColor(t) }]} />
                  <Text style={styles.legendText}>{TIER_RU[t]}</Text>
                </View>
              ))}
              {polygons.length > 0 && (
                <View style={styles.legendItem}>
                  <View style={styles.legendSquare} />
                  <Text style={styles.legendText}>дневник закрыт</Text>
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
  legendText: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 14, color: colors.textMuted },
  link: { fontFamily: fonts.sansSemi, fontSize: 14, lineHeight: 18, color: colors.accentBright },
});
