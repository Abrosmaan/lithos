// Профиль (spec §8, §12; T3.3): имя (lithos.users.display_name), статистика — сканов всего (scans),
// распределение по тирам (cards), редчайшая карточка, самая далёкая находка; витрина до 12 карточек (локально).
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BigButton } from '../components/BigButton';
import { CardTile } from '../components/CardTile';
import { Section } from '../components/Section';
import { formatDateRu } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { farthestFind, formatDistance } from '../lib/geo-math';
import { loadCards } from '../lib/offline-cache';
import { fetchPrimaryPhotoUrls } from '../lib/photo-urls';
import { countScans, DISPLAY_NAME_MAX, fetchProfile, type Profile, updateDisplayName } from '../lib/profile';
import { pruneShowcase, readShowcase, SHOWCASE_MAX } from '../lib/showcase';
import { rarestCard, tierDistribution } from '../lib/stats';
import type { TabScreenProps } from '../navigation/types';
import { colors, radius, spacing, tierColor } from '../theme';

type Props = TabScreenProps<'Profile'>;

export const DEFAULT_NAME = 'Собиратель камней';

export function ProfileScreen({ navigation }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [scans, setScans] = useState<number | null>(null);
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [showcaseIds, setShowcaseIds] = useState<string[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (isFocused: () => boolean = () => true) => {
    const my = ++seq.current;
    const isAlive = () => isFocused() && my === seq.current;
    try {
      const [c, stored] = await Promise.all([loadCards(), readShowcase()]);
      if (!isAlive()) return;
      // Витрина: id карточек, которых больше нет среди видимых, вычищаются (только не офлайн — кэш может быть неполным).
      const ids = c.offline ? stored : await pruneShowcase(stored, new Set(c.data.filter((x) => !x.hidden).map((x) => x.id)));
      if (!isAlive()) return;
      setCards(c.data);
      setShowcaseIds(ids);
      setOffline(c.offline);
      setError(null);
      // Имя и счётчик — только из сети; офлайн остаются прошлые значения / «—».
      const [p, n] = await Promise.all([
        fetchProfile().catch((e) => { logError('profile.user', e); return null; }),
        countScans().catch((e) => { logError('profile.scans', e); return null; }),
      ]);
      if (!isAlive()) return;
      if (p) setProfile(p);
      if (n !== null) setScans(n);
      // Фото — только для плиток на экране: витрина, редчайшая, самая далёкая.
      const shown = c.data.filter((x) => !x.hidden);
      const wanted = new Set<string>([...ids, rarestCard(shown)?.id ?? '', farthestFind(shown)?.card.id ?? '']);
      const photos = await fetchPrimaryPhotoUrls(shown.filter((x) => wanted.has(x.id)).map((x) => x.scan_id));
      if (isAlive()) setUrls(photos);
    } catch (e) {
      if (!isAlive()) return;
      logError('profile', e);
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

  const saveName = async () => {
    setSaving(true);
    try {
      const value = await updateDisplayName(draft);
      setProfile((p) => (p ? { ...p, displayName: value } : p));
      if (!profile) fetchProfile().then(setProfile).catch((e) => logError('profile.user', e));
      setEditing(false);
    } catch (e) {
      logError('profile.rename', e);
      Alert.alert('Не получилось', toUserMessage(e, MSG.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  const visible = useMemo(() => (cards ?? []).filter((c) => !c.hidden), [cards]);
  const buckets = useMemo(() => tierDistribution(visible), [visible]);
  const rarest = useMemo(() => rarestCard(visible), [visible]);
  const farthest = useMemo(() => farthestFind(visible), [visible]);
  const showcase = useMemo(() => showcaseIds.map((id) => visible.find((c) => c.id === id)).filter((c): c is CardRow => !!c), [showcaseIds, visible]);
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const openCard = (cardId: string) => navigation.navigate('Card', { cardId });

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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.text} />}
    >
      {offline && <Text style={styles.note}>Нет связи — показаны сохранённые данные.</Text>}
      {error && !offline && <Text style={styles.note}>{error}</Text>}

      <View style={styles.hero}>
        {editing ? (
          <View style={styles.editRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={DEFAULT_NAME}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              maxLength={DISPLAY_NAME_MAX}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => { void saveName(); }}
            />
            <View style={styles.editButtons}>
              <BigButton label="Сохранить" onPress={() => { void saveName(); }} loading={saving} style={styles.editBtn} />
              <BigButton label="Отмена" variant="secondary" onPress={() => setEditing(false)} disabled={saving} style={styles.editBtn} />
            </View>
          </View>
        ) : (
          <Pressable onPress={() => { setDraft(profile?.displayName ?? ''); setEditing(true); }} accessibilityRole="button" accessibilityLabel="Изменить имя">
            <Text style={styles.name}>{profile?.displayName ?? DEFAULT_NAME}</Text>
            <Text style={styles.rename}>{profile ? 'нажмите, чтобы изменить имя' : 'имя загрузится при появлении сети'}</Text>
          </Pressable>
        )}
        {profile?.createdAt && formatDateRu(profile.createdAt) && <Text style={styles.since}>в Lithos с {formatDateRu(profile.createdAt)}</Text>}
      </View>

      <View style={styles.statsRow}>
        <Stat label="Сканов" value={scans === null ? '—' : String(scans)} />
        <Stat label="Карточек" value={String(visible.length)} />
        <Stat label="Ячеек" value={String(new Set(visible.map((c) => c.cell_id).filter(Boolean)).size)} />
      </View>

      <Section title="По тирам">
        {buckets.map((b) => (
          <View key={String(b.tier)} style={styles.barRow}>
            <Text style={styles.barLabel}>{b.label}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.max(b.count > 0 ? 4 : 0, Math.round((b.count / maxCount) * 100))}%`, backgroundColor: tierColor(b.tier) }]} />
            </View>
            <Text style={styles.barCount}>{b.count}</Text>
          </View>
        ))}
        {visible.length === 0 && <Text style={styles.muted}>Пока нет карточек.</Text>}
      </Section>

      {(rarest || farthest) && (
        <View style={styles.highlights}>
          {rarest && (
            <View style={styles.highlight}>
              <Text style={styles.highlightTitle}>Редчайшая</Text>
              <CardTile card={rarest} photoUrl={urls.get(rarest.scan_id)} caption={`${rarest.score ?? '—'} очков`} onPress={() => openCard(rarest.id)} />
            </View>
          )}
          {farthest && (
            <View style={styles.highlight}>
              <Text style={styles.highlightTitle}>Самая далёкая</Text>
              <CardTile card={farthest.card} photoUrl={urls.get(farthest.card.scan_id)} caption={`${formatDistance(farthest.km)} от первой находки`} onPress={() => openCard(farthest.card.id)} />
            </View>
          )}
        </View>
      )}

      <Section title={`Витрина · ${showcase.length} из ${SHOWCASE_MAX}`}>
        {showcase.length === 0 ? (
          <Text style={styles.muted}>Добавьте лучшие карточки кнопкой «В витрину» на экране карточки.</Text>
        ) : (
          <View style={styles.grid}>
            {showcase.map((c) => (
              <View key={c.id} style={styles.gridItem}>
                <CardTile card={c} photoUrl={urls.get(c.scan_id)} onPress={() => openCard(c.id)} />
              </View>
            ))}
          </View>
        )}
      </Section>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  stretch: { alignSelf: 'stretch' },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  note: { color: '#e0c36a', fontSize: 14, textAlign: 'center' },
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
  name: { color: colors.text, fontSize: 26, fontWeight: '800' },
  rename: { color: colors.textMuted, fontSize: 13 },
  since: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  editRow: { gap: spacing.sm },
  editButtons: { flexDirection: 'row', gap: spacing.sm },
  editBtn: { flex: 1, minHeight: 48 },
  input: { backgroundColor: colors.bg, color: colors.text, fontSize: 18, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm + 4 },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', gap: 2 },
  statValue: { color: colors.text, fontSize: 26, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 13 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 3 },
  barLabel: { color: colors.text, fontSize: 14, width: 104 },
  barTrack: { flex: 1, height: 12, borderRadius: radius.full, backgroundColor: colors.surfaceActive, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radius.full },
  barCount: { color: colors.text, fontSize: 14, fontWeight: '600', width: 28, textAlign: 'right' },
  highlights: { flexDirection: 'row', gap: spacing.sm },
  highlight: { flex: 1, gap: spacing.xs },
  highlightTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridItem: { width: '48%', flexGrow: 1 },
});
