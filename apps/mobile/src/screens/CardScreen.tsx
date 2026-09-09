// Карточка камня (spec §5, экран 9 прототипа): галерея 300×224 со snap и круглой кнопкой назад, имя Playfair 25 +
// своё имя + ID mono, блок тира (TierLine, плашки, «Разбор score»), список кандидатов, секции ключ-значение
// ПОРОДА / СОСТАВ / МЕСТО И ДАТА / ЛОР, история версий с точками, «Дневник этого места», кнопки.
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { useCallback, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { IdentificationList, IdentificationNote } from '../components/IdentificationList';
import { Section } from '../components/Section';
import { Chevron, DeltaPill, KeyValue, LinkRow, Note, PhotoPlaceholder, TierLine } from '../components/ui';
import { displayName, formatCoords, formatDateRu, inclusionLines, rockClassRu, rockGroupRu, shapeSummary, splitDelta, tierLabel, VERIFICATION_RU } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { type CardPhoto, fetchAgeRange, fetchCard, fetchScanPhotos, fetchScanResults, updateCardUserName } from '../lib/cards';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { splitRecommended, type VersionEntry, versionHistory } from '../lib/history';
import { cardIdentification, identificationBefore, type IdentificationView } from '../lib/identification-view';
import { breakdownRows, cardShortId, historyLines, scoreText, STATE_RU } from '../lib/screen-text';
import { readShowcase, SHOWCASE_MAX, toggleShowcaseCard } from '../lib/showcase';
import type { RootStackParamList } from '../navigation/types';
import { useSplitFlow } from '../navigation/useSplitFlow';
import { colors, density, fonts, radius, spacing, tierColor, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Card'>;

interface Loaded {
  card: CardRow;
  photos: CardPhoto[];
  history: VersionEntry[];
  /** Список кандидатов: meta карточки, иначе scan_results (старые карточки); null — нечего показать. */
  identification: IdentificationView | null;
  /** «было: …» — первичный список, если уточнение его изменило. */
  identificationBefore: string | null;
  split: boolean;
  age: string | null;
  parent: CardRow | null;
}

const PHOTO_W = 300;
const PHOTO_H = 224;
const PHOTO_GAP = 8;

export function CardScreen({ navigation, route }: Props) {
  const { cardId } = route.params;
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  const [inShowcase, setInShowcase] = useState(false);
  const [showcaseFull, setShowcaseFull] = useState(false);
  const insets = useSafeAreaInsets();
  const goSplit = useSplitFlow();

  // Заголовок рисуем сами: круглая кнопка назад поверх галереи (прототип).
  useLayoutEffect(() => { navigation.setOptions({ headerShown: false }); }, [navigation]);

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
      setData({
        card, photos, history: versionHistory(rows),
        identification: cardIdentification(card, rows), identificationBefore: identificationBefore(rows),
        split: card.split_recommended ?? splitRecommended(rows), age, parent,
      });
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

  // Витрина (spec §8): до SHOWCASE_MAX карточек, выбор локальный (T3.3). Переполнение — плашка под кнопкой.
  const toggleShowcase = async () => {
    if (!data) return;
    const res = await toggleShowcaseCard(data.card.id);
    setShowcaseFull(res.status === 'full');
    if (res.status !== 'full') setInShowcase(res.status === 'added');
  };

  const goBack = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs', { screen: 'Collection' }));

  if (error && !data) {
    return (
      <View style={styles.center}>
        <Text style={type.small}>{error}</Text>
        <BigButton label="Обновить" onPress={() => { void load(); }} style={styles.stretch} />
        <BigButton label="Назад" variant="secondary" onPress={goBack} style={styles.stretch} />
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

  const { card, photos, history, identification, identificationBefore: wasBefore, split, age, parent } = data;
  const pending = card.verification === 'pending_review';
  const accent = pending ? colors.textFaint : tierColor(card.tier);
  const shape = shapeSummary(card.shape);
  const composition = inclusionLines(card.inclusions);
  const delta = card.parent_card_id ? splitDelta(card, parent?.score) : null;
  const canSplit = split && card.state === 'closed' && !card.hidden;
  const autoName = card.name?.trim() || rockClassRu(card.rock_class);
  const lines = historyLines({
    history, before: wasBefore, provisional: card.provisional, verification: card.verification,
    parent: parent ? { id: parent.id, name: displayName(parent), score: parent.score } : null,
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom + 30 }]}>
      {error && (
        <Pressable onPress={() => { void load(); }} accessibilityRole="button" style={styles.pad}>
          <Note tone="danger">{error} Нажмите, чтобы обновить.</Note>
        </Pressable>
      )}

      {/* Галерея: 300×224 со snap; без фото — полосатый плейсхолдер той же формы. */}
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={PHOTO_W + PHOTO_GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          contentContainerStyle={styles.gallery}
        >
          {photos.length > 0 ? photos.map((p) => (
            <Image key={p.path} source={{ uri: p.url }} style={styles.photo} contentFit="cover" transition={150} accessibilityLabel={p.isPrimary ? 'Лицевое фото' : 'Фото камня'} />
          )) : (
            <PhotoPlaceholder label="фото недоступно" height={PHOTO_H} style={styles.photo} />
          )}
        </ScrollView>
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Назад" style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Chevron direction="left" color={colors.text} size={10} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {/* Имя: автоимя Playfair 25, своё имя строкой ниже, ID mono. */}
        <View style={styles.nameBlock}>
          <Text style={styles.name}>{autoName}</Text>
          {editing ? (
            <View style={styles.editRow}>
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                placeholder="Своё имя камня"
                placeholderTextColor={colors.textDim}
                style={styles.input}
                maxLength={60}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => { void saveName(); }}
                editable={!saving}
              />
              <Pressable onPress={() => { void saveName(); }} disabled={saving} accessibilityRole="button" style={({ pressed }) => [styles.saveBtn, (pressed || saving) && styles.pressed]}>
                {saving ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.saveText}>Сохранить</Text>}
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => { setDraftName(card.user_name ?? ''); setEditing(true); }} accessibilityRole="button" accessibilityLabel="Дать своё имя" style={styles.ownRow}>
              <Text style={[styles.ownName, !card.user_name && { color: colors.accentBright }]}>{card.user_name ?? 'Дать своё имя'}</Text>
              {card.user_name ? <Text style={styles.ownHint}>изменить</Text> : null}
            </Pressable>
          )}
          {editing && <Pressable onPress={() => setEditing(false)} disabled={saving} accessibilityRole="button"><Text style={styles.ownHint}>отмена</Text></Pressable>}
          <Text style={type.monoId}>{cardShortId(card.id)}</Text>
        </View>

        {/* Блок тира: рамка цвета тира, шов и цифра, плашки статусов, разбор score. */}
        <View style={[styles.tierBlock, { borderColor: accent }]}>
          <TierLine tierName={tierLabel(card.tier, card.verification)} tier={card.tier} scoreText={scoreText(card)} size="md" pendingReview={pending} />
          <View style={styles.tags}>
            <Tag text={VERIFICATION_RU[card.verification]} />
            <Tag text={STATE_RU[card.state]} />
            {card.provisional && <Tag text="Предварительно" gold />}
            {card.hidden && <Tag text="Была раскрыта" danger />}
          </View>
          {delta && <DeltaPill text={`после раскола: ${delta.text}`} negative={delta.sign === 'down'} />}
          {card.score === null && !pending && <Note>Без геопозиции редкость не считается: слой «Место» недоступен.</Note>}
          {pending && <Note>Тир «?» — карточка на проверке: порода не совпадает с геологией места.</Note>}
          <Pressable onPress={() => setShowBreakdown((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showBreakdown }} style={styles.breakdownHead}>
            <Text style={type.bodyStrong}>Разбор score</Text>
            <Chevron direction={showBreakdown ? 'up' : 'down'} />
          </Pressable>
          {showBreakdown && (
            <View style={styles.layers}>
              {breakdownRows(card).map((l) => (
                <View key={l.key} style={styles.layer}>
                  <Text style={styles.layerPts}>{l.pts}</Text>
                  <View style={styles.layerBody}>
                    <Text style={styles.layerLabel}>{l.label}</Text>
                    <Text style={styles.layerWhy}>{l.why}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Список кандидатов заменяет строку «Порода» — не дублируем. */}
        <Section title="Порода">
          {identification ? <IdentificationList view={identification} accent={accent} /> : <KeyValue k="Порода" v={rockClassRu(card.rock_class)} />}
          <KeyValue k="Группа" v={rockGroupRu(card.rock_class)} />
          {shape.surface && <KeyValue k="Поверхность" v={shape.surface} />}
          {shape.naturalHole && <KeyValue k="Форма" v="Сквозное отверстие" />}
          {identification && <IdentificationNote />}
        </Section>

        <Section title="Состав">
          <KeyValue k="Включения" v={composition.length > 0 ? composition.join(' · ') : 'Без уверенных включений'} />
        </Section>

        <Section title="Место и дата">
          <KeyValue k="Место" v={formatCoords(card.lat, card.lng) ?? 'Место не записано'} />
          <KeyValue k="Дата" v={formatDateRu(card.created_at) ?? '—'} />
          <KeyValue k="Возраст региона" v={age ?? 'неизвестен'} />
        </Section>

        {card.lore ? (
          <Section title="Лор">
            <Text style={type.lore}>{card.lore}</Text>
          </Section>
        ) : null}

        {lines.length > 0 && (
          <Section title="История версий">
            {lines.map((h, i) => {
              const row = (
                <View style={styles.version}>
                  <View style={[styles.dot, { backgroundColor: i === 0 ? colors.textFaint : colors.accentBright }]} />
                  <View style={styles.versionBody}>
                    <Text style={styles.versionTitle}>{h.title}</Text>
                    {h.meta ? <Text style={styles.versionMeta}>{h.meta}</Text> : null}
                  </View>
                </View>
              );
              return h.cardId ? (
                <Pressable key={h.key} onPress={() => navigation.push('Card', { cardId: h.cardId! })} accessibilityRole="link">{row}</Pressable>
              ) : (
                <View key={h.key}>{row}</View>
              );
            })}
          </Section>
        )}

        {card.cell_id && <LinkRow label="Дневник этого места" onPress={() => navigation.navigate('Diary', { cellId: card.cell_id ?? undefined })} />}

        <View style={styles.buttons}>
          {canSplit && <BigButton label="Расколоть и пересканировать" variant="danger" onPress={() => { void goSplit(card.id); }} />}
          {!card.hidden && <BigButton label={inShowcase ? 'Убрать из витрины' : 'В витрину'} variant="secondary" onPress={() => { void toggleShowcase(); }} />}
          {showcaseFull && <Note tone="danger" style={styles.noteCenter}>Витрина заполнена — в ней уже {SHOWCASE_MAX} карточек. Уберите одну, чтобы добавить эту.</Note>}
          <BigButton label="В коллекцию" onPress={() => navigation.navigate('Tabs', { screen: 'Collection' }, { pop: true })} />
        </View>
      </View>
    </ScrollView>
  );
}

function Tag({ text, gold, danger }: { text: string; gold?: boolean; danger?: boolean }) {
  return (
    <View style={[styles.tag, gold && styles.tagGold, danger && styles.tagDanger]}>
      <Text style={[styles.tagText, gold && { color: colors.goldText }, danger && { color: colors.dangerTextSoft }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { gap: density.gap },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  stretch: { alignSelf: 'stretch' },
  pad: { paddingHorizontal: spacing.md },
  pressed: { opacity: 0.8 },
  gallery: { paddingHorizontal: spacing.md, gap: PHOTO_GAP },
  photo: { width: PHOTO_W, height: PHOTO_H, borderRadius: 18, backgroundColor: '#1e2632', overflow: 'hidden' },
  back: { position: 'absolute', top: 10, left: 24, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(11,15,20,0.72)', alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: spacing.md, gap: density.gap },
  nameBlock: { gap: 7 },
  name: { ...type.h2, fontSize: 25, lineHeight: 30 },
  ownRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  ownName: { fontFamily: fonts.sans, fontSize: 14, color: colors.text },
  ownHint: { fontFamily: fonts.sans, fontSize: 12, color: colors.textDim },
  editRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, paddingVertical: 12, paddingHorizontal: 13, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(63,191,163,0.4)', color: colors.text, fontFamily: fonts.sans, fontSize: 14.5 },
  saveBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', minWidth: 96 },
  saveText: { fontFamily: fonts.sansSemi, fontSize: 14.5, color: colors.accentText },
  tierBlock: { gap: 12, padding: 15, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingVertical: 6, paddingHorizontal: 11, borderRadius: radius.xs, backgroundColor: colors.surface2 },
  tagGold: { backgroundColor: colors.goldTint },
  tagDanger: { backgroundColor: colors.dangerTint },
  tagText: { fontFamily: fonts.sans, fontSize: 12, color: colors.chipText },
  breakdownHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2, paddingRight: 4 },
  layers: { gap: 10, paddingTop: 2 },
  layer: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  layerPts: { width: 42, fontFamily: fonts.monoBold, fontSize: 13, lineHeight: 17, color: colors.accentBright },
  layerBody: { flex: 1, gap: 2 },
  layerLabel: { fontFamily: fonts.sansSemi, fontSize: 13.5, lineHeight: 17, color: colors.text },
  layerWhy: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: colors.textMuted },
  version: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 6 },
  versionBody: { flex: 1, gap: 2 },
  versionTitle: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 18, color: colors.text },
  versionMeta: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: colors.textDim },
  buttons: { gap: 9 },
  noteCenter: { alignItems: 'center' },
});
