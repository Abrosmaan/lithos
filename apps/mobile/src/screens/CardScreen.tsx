// Карточка камня (spec §5): имя (автоген + своё), тир/score, фото, порода, состав, место и дата,
// возраст региона, лор, верификация, состояние, breakdown по тапу, история версий, раскол.
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { Line, Section } from '../components/Section';
import { TierBadge } from '../components/TierBadge';
import {
  describeBreakdown, displayName, formatCoords, formatDateRu, inclusionLines, rockClassRu, rockGroupRu, shapeSummary,
  splitDelta, VERIFICATION_RU,
} from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { type CardPhoto, fetchAgeRange, fetchCard, fetchScanPhotos, fetchScanResults, updateCardUserName } from '../lib/cards';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { splitRecommended, type VersionEntry, versionHistory } from '../lib/history';
import { readShowcase, SHOWCASE_MAX, toggleShowcaseCard } from '../lib/showcase';
import type { RootStackParamList } from '../navigation/types';
import { useSplitFlow } from '../navigation/useSplitFlow';
import { colors, radius, spacing, tierColor } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Card'>;

interface Loaded {
  card: CardRow;
  photos: CardPhoto[];
  history: VersionEntry[];
  split: boolean;
  age: string | null;
  parent: CardRow | null;
}

export function CardScreen({ navigation, route }: Props) {
  const { cardId } = route.params;
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  const [inShowcase, setInShowcase] = useState(false);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const goSplit = useSplitFlow();

  const load = useCallback(async (isAlive: () => boolean = () => true) => {
    try {
      const card = await fetchCard(cardId);
      if (!isAlive()) return;
      if (!card) { setError('Карточка не найдена.'); return; }
      const [photos, rows, age, parent, showcase] = await Promise.all([
        fetchScanPhotos(card.scan_id).catch((e) => { logError('card.photos', e); return [] as CardPhoto[]; }),
        fetchScanResults(card.scan_id).catch((e) => { logError('card.results', e); return []; }),
        fetchAgeRange(card.cell_id),
        card.parent_card_id ? fetchCard(card.parent_card_id).catch(() => null) : Promise.resolve(null),
        readShowcase(),
      ]);
      if (!isAlive()) return;
      setData({ card, photos, history: versionHistory(rows), split: card.split_recommended ?? splitRecommended(rows), age, parent });
      setInShowcase(showcase.includes(card.id));
      setError(null);
    } catch (e) {
      if (!isAlive()) return;
      logError('card.load', e);
      setError(toUserMessage(e, MSG.loadFailed));
    }
  }, [cardId]);

  // Перезагрузка при каждом фокусе (после переименования/раскола); устаревший ответ не перетирает свежий.
  useFocusEffect(useCallback(() => {
    let alive = true;
    void load(() => alive);
    return () => { alive = false; };
  }, [load]));

  const saveName = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const name = draftName.trim() || null;
      await updateCardUserName(data.card.id, name);
      setData({ ...data, card: { ...data.card, user_name: name } });
      setEditing(false);
    } catch (e) {
      logError('card.rename', e);
      Alert.alert('Не получилось', toUserMessage(e, MSG.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  // Витрина (spec §8): до 12 карточек, выбор локальный (T3.3).
  const toggleShowcase = async () => {
    if (!data) return;
    const res = await toggleShowcaseCard(data.card.id);
    if (res.status === 'full') { Alert.alert('Витрина заполнена', `В витрине уже ${SHOWCASE_MAX} карточек. Уберите одну, чтобы добавить эту.`); return; }
    setInShowcase(res.status === 'added');
  };

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
      </View>
    );
  }

  const { card, photos, history, split, age, parent } = data;
  const accent = card.verification === 'pending_review' ? tierColor(null) : tierColor(card.tier);
  const place = formatCoords(card.lat, card.lng);
  const date = formatDateRu(card.created_at);
  const shape = shapeSummary(card.shape);
  const composition = inclusionLines(card.inclusions);
  const delta = card.parent_card_id ? splitDelta(card, parent?.score) : null;
  const canSplit = split && card.state === 'closed' && !card.hidden;
  const photoW = width - spacing.md * 2;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
      {error && (
        <Pressable onPress={() => { void load(); }} accessibilityRole="button" style={styles.errorBanner}>
          <Text style={styles.errorText}>{error} Нажмите, чтобы обновить.</Text>
        </Pressable>
      )}
      {photos.length > 0 && (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.gallery}>
          {photos.map((p) => (
            <Image key={p.path} source={{ uri: p.url }} style={[styles.photo, { width: photoW }]} contentFit="cover" transition={150} />
          ))}
        </ScrollView>
      )}

      <View style={[styles.hero, { borderColor: accent }]}>
        <View style={styles.badges}>
          <TierBadge tier={card.tier} verification={card.verification} size="lg" />
          {card.provisional && <Tag text="Предварительно" color={colors.warning} />}
          <Tag text={card.state === 'opened' ? 'Раскрытый' : 'Закрытый'} color={colors.surfaceActive} />
          {card.hidden && <Tag text="Была раскрыта" color={colors.danger} />}
        </View>

        {editing ? (
          <View style={styles.editRow}>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder={card.name ?? rockClassRu(card.rock_class)}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              maxLength={60}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => { void saveName(); }}
            />
            <BigButton label="Сохранить" onPress={() => { void saveName(); }} loading={saving} style={styles.saveBtn} />
            <BigButton label="Отмена" variant="secondary" onPress={() => setEditing(false)} disabled={saving} style={styles.saveBtn} />
          </View>
        ) : (
          <Pressable onPress={() => { setDraftName(card.user_name ?? ''); setEditing(true); }} accessibilityRole="button" accessibilityLabel="Переименовать">
            <Text style={styles.name}>{displayName(card)}</Text>
            <Text style={styles.rename}>{card.user_name ? `автоимя: ${card.name ?? rockClassRu(card.rock_class)} · изменить` : 'нажмите, чтобы дать своё имя'}</Text>
          </Pressable>
        )}

        <Pressable onPress={() => setShowBreakdown((v) => !v)} accessibilityRole="button" style={styles.scoreRow}>
          <Text style={[styles.score, { color: accent }]}>{card.score !== null ? `${card.score} очков` : 'без редкости — нет геопозиции'}</Text>
          {card.score_breakdown && <Text style={styles.scoreHint}>{showBreakdown ? 'скрыть расчёт ▲' : 'как посчитано ▼'}</Text>}
        </Pressable>
        {delta && <Text style={styles.delta}>После раскола: {delta.text}</Text>}
        <Text style={styles.verification}>{VERIFICATION_RU[card.verification]}</Text>
      </View>

      {showBreakdown && card.score_breakdown && (
        <View style={styles.breakdown}>
          {describeBreakdown(card.score_breakdown).map((layer) => (
            <View key={layer.key} style={styles.layer}>
              <View style={styles.layerHead}>
                <Text style={styles.layerTitle}>{layer.title}</Text>
                <Text style={styles.layerPoints}>{layer.points} / {layer.max}</Text>
              </View>
              {layer.lines.map((l, i) => (
                <View key={i} style={styles.layerLine}>
                  <Text style={styles.layerText}>{l.text}</Text>
                  {l.points !== undefined && <Text style={styles.layerLinePoints}>{l.points}</Text>}
                </View>
              ))}
            </View>
          ))}
          {card.score === null && <Text style={styles.muted}>Слои посчитаны, но без геопозиции итоговый score не присваивается.</Text>}
        </View>
      )}

      <Section title="Порода">
        <Line>{rockClassRu(card.rock_class)}</Line>
        <Line muted>{rockGroupRu(card.rock_class)}{shape.surface ? ` · ${shape.surface.toLowerCase()}` : ''}{shape.naturalHole ? ' · сквозное отверстие' : ''}</Line>
      </Section>

      <Section title="Состав">
        {composition.length > 0 ? composition.map((c) => <Line key={c}>{c}</Line>) : <Line muted>Включений не обнаружено</Line>}
      </Section>

      <Section title="Место и дата">
        <Line>{place ?? 'Без геопозиции'}{date ? ` · ${date}` : ''}</Line>
        {age && <Line muted>Геологический возраст региона: {age}</Line>}
        <Line muted>ID {card.id.slice(0, 8)}</Line>
        {card.cell_id && (
          <Pressable onPress={() => navigation.navigate('Diary', { cellId: card.cell_id ?? undefined })} accessibilityRole="link">
            <Text style={styles.link}>Дневник этого места →</Text>
          </Pressable>
        )}
      </Section>

      {card.lore ? (
        <Section title="Лор">
          <Line>{card.lore}</Line>
        </Section>
      ) : null}

      {(history.length > 0 || parent) && (
        <Section title="История версий">
          {history.map((h) => (
            <View key={h.stage} style={styles.version}>
              <Line>{h.title}{h.rockClassRu ? `: ${h.rockClassRu}` : ''}</Line>
              {h.note && <Line muted>{h.note}</Line>}
              {h.usedFallback && <Line muted>резервный провайдер</Line>}
            </View>
          ))}
          {parent && (
            <Pressable onPress={() => navigation.push('Card', { cardId: parent.id })} accessibilityRole="link">
              <Text style={styles.link}>До раскола: {displayName(parent)} →</Text>
            </Pressable>
          )}
        </Section>
      )}

      {canSplit && (
        <>
          <BigButton label="Расколоть и пересканировать" onPress={() => { void goSplit(card.id); }} />
          <Text style={styles.muted}>Снаружи обычный — внутри может быть что-то. Раскол необратим: эта карточка станет «раскрытой».</Text>
        </>
      )}
      {!card.hidden && (
        <BigButton label={inShowcase ? 'Убрать из витрины' : 'В витрину'} variant="secondary" onPress={() => { void toggleShowcase(); }} />
      )}
      <BigButton label="В коллекцию" variant="secondary" onPress={() => navigation.navigate('Tabs', { screen: 'Collection' }, { pop: true })} />
    </ScrollView>
  );
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: color }]}>
      <Text style={styles.tagText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  stretch: { alignSelf: 'stretch' },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  gallery: { borderRadius: radius.lg, overflow: 'hidden' },
  photo: { height: 280, backgroundColor: colors.surface },
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, padding: spacing.lg, gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  name: { color: colors.text, fontSize: 26, fontWeight: '800', lineHeight: 32 },
  rename: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  editRow: { gap: spacing.sm },
  input: { backgroundColor: colors.bg, color: colors.text, fontSize: 18, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm + 4 },
  saveBtn: { minHeight: 48 },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  score: { fontSize: 22, fontWeight: '700' },
  scoreHint: { color: colors.textMuted, fontSize: 14 },
  delta: { color: colors.text, fontSize: 15, fontWeight: '600' },
  verification: { color: colors.textMuted, fontSize: 14 },
  errorBanner: { backgroundColor: colors.warning, borderRadius: radius.md, padding: spacing.md },
  errorText: { color: '#fff', fontSize: 15 },
  breakdown: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  layer: { gap: spacing.xs },
  layerHead: { flexDirection: 'row', justifyContent: 'space-between' },
  layerTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  layerPoints: { color: colors.text, fontSize: 16, fontWeight: '700' },
  layerLine: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  layerText: { color: colors.textMuted, fontSize: 14, flex: 1 },
  layerLinePoints: { color: colors.textMuted, fontSize: 14 },
  version: { gap: 2, paddingVertical: spacing.xs },
  link: { color: '#7cc4ff', fontSize: 16, paddingVertical: spacing.xs },
  tag: { paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.full },
  tagText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
