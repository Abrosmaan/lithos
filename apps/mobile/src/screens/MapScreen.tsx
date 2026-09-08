// Карта (spec §8, T3.2): точки сканов цветом тира, тап → карточка, ячейки с закрытым дневником подсвечены.
// react-native-maps: Apple Maps на iOS без ключа; Android требует Google Maps API key (см. docs/tasks/T3.2.md).
// Офлайн — точки из кэша AsyncStorage (тайлы карты офлайн не гарантируются).
import { TIER_RU, TIERS } from '@lithos/shared';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { displayName, tierLabel } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { completedCells, type DiaryRow } from '../lib/diary';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { boundingRegion } from '../lib/geo-math';
import { cellPolygon } from '../lib/geohash';
import { loadCards, loadDiary } from '../lib/offline-cache';
import { pluralRu } from '../lib/text';
import type { TabScreenProps } from '../navigation/types';
import { colors, mapColors, radius, spacing, tierColor } from '../theme';

type Props = TabScreenProps<'Map'>;

type Point = CardRow & { lat: number; lng: number };

/** Стартовый регион без точек: Черноморское побережье (spec §16 — фокус прототипа). */
const DEFAULT_REGION = { latitude: 44.6, longitude: 37.9, latitudeDelta: 6, longitudeDelta: 6 };
const FIT_PADDING = { top: 80, right: 40, bottom: 140, left: 40 };

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
        <BigButton label="Обновить" onPress={() => { void load(); }} style={styles.stretch} />
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
            <View style={[styles.dot, { backgroundColor: c.verification === 'pending_review' ? tierColor(null) : tierColor(c.tier) }]} />
          </Marker>
        ))}
      </MapView>

      {(offline || (error && cards)) && (
        <View style={[styles.banner, { top: spacing.sm }]}>
          <Text style={styles.bannerText}>{offline ? 'Нет связи — показаны сохранённые точки.' : error}</Text>
        </View>
      )}

      <View style={[styles.legend, { bottom: insets.bottom > 0 ? spacing.sm : spacing.md }]}>
        {cards === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : points.length === 0 ? (
          <View style={styles.legendEmpty}>
            <Text style={styles.legendTitle}>Пока нет точек</Text>
            <Text style={styles.muted}>Отсканируйте камень с геопозицией — он появится на карте.</Text>
            <Pressable onPress={() => navigation.navigate('Tabs', { screen: 'Camera' }, { pop: true })} accessibilityRole="button">
              <Text style={styles.link}>Сканировать →</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.legendTitle}>
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
                  <View style={[styles.legendSquare]} />
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
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  stretch: { alignSelf: 'stretch' },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  dot: { width: 18, height: 18, borderRadius: radius.full, borderWidth: 2.5, borderColor: '#fff' },
  banner: { position: 'absolute', left: spacing.md, right: spacing.md, backgroundColor: 'rgba(138,109,31,0.95)', borderRadius: radius.md, padding: spacing.sm + 2 },
  bannerText: { color: '#fff', fontSize: 14, textAlign: 'center' },
  legend: { position: 'absolute', left: spacing.md, right: spacing.md, backgroundColor: 'rgba(22,28,36,0.94)', borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  legendEmpty: { gap: spacing.xs },
  legendTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm + 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: radius.full },
  legendSquare: { width: 10, height: 10, backgroundColor: mapColors.cellFill, borderWidth: 1, borderColor: mapColors.cellStroke },
  legendText: { color: colors.textMuted, fontSize: 12 },
  link: { color: '#7cc4ff', fontSize: 15, fontWeight: '600' },
});
