// Карточка камня (spec §5, экран 9 прототипа): галерея 300×224 со snap и круглой кнопкой назад, имя Playfair 25 +
// своё имя + ID mono, блок тира (TierLine, плашки, «Разбор score»), список кандидатов, секции ключ-значение
// ПОРОДА / СОСТАВ / МЕСТО И ДАТА / ЛОР, история версий с точками, «Дневник этого места», кнопки.
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { IdentificationList, IdentificationNote } from '../components/IdentificationList';
import { Section } from '../components/Section';
import { Chevron, DeltaPill, KeyValue, LinkRow, Note, PhotoPlaceholder, SectionLabel, TierLine } from '../components/ui';
import { displayName, formatCoords, formatDateRu, inclusionLines, rockClassRu, rockGroupRu, shapeSummary, splitDelta, tierLabel, VERIFICATION_RU, type RockClass } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { type CardPhoto, fetchAgeRange, fetchCard, fetchScanPhotos, fetchScanResults, listAllCards, updateCardUserName } from '../lib/cards';
import { LABEL_ACTIONS, LABEL_FEEDBACK, LABEL_PICKER, LABEL_STATUS, SHOWCASE_HINT, UNPUBLISH_DIALOG } from '../lib/consent';
import { publishDialogCopy } from '../lib/publish-copy';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { splitRecommended, type VersionEntry, versionHistory } from '../lib/history';
import { cardIdentification, identificationBefore, type IdentificationView } from '../lib/identification-view';
import { fetchMyLabels, latestLabel, recordLabel, type MyLabelRow } from '../lib/labels';
import { fetchProfile } from '../lib/profile';
import { setPublished } from '../lib/publish';
import { filterRockPickerGroups, rockPickerGroups } from '../lib/rock-picker';
import { breakdownRows, cardShortId, cardsCountText, historyLines, scoreText, STATE_RU } from '../lib/screen-text';
import { isPublishExplained, isShowcaseMigrationDone, markPublishExplained, markShowcaseMigrationDone, planShowcaseMigration, readShowcase } from '../lib/showcase';
import type { RootStackParamList } from '../navigation/types';
import { useSplitFlow } from '../navigation/useSplitFlow';
import { colors, density, fonts, placeholderStripes, radius, spacing, tierColor, type } from '../theme';

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
  /** Своя метка (T7.1, поток B): факт «вы подтвердили»/«вы указали другую породу», не card.verification. */
  myLabel: MyLabelRow | null;
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
  const [publishing, setPublishing] = useState(false);
  // T7.1, поток B: подтверждение/исправление вердикта. labelAction — какая кнопка сейчас грузится (спиннер
  // только на ней), pickerOpen/pickerQuery — шторка выбора породы для «Это другая порода».
  const [labelAction, setLabelAction] = useState<'confirm' | 'correct' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const pickerGroups = useMemo(() => rockPickerGroups(), []);
  const filteredPickerGroups = useMemo(() => filterRockPickerGroups(pickerGroups, pickerQuery), [pickerGroups, pickerQuery]);
  const insets = useSafeAreaInsets();
  const goSplit = useSplitFlow();
  const migrationChecked = useRef(false);

  // Заголовок рисуем сами: круглая кнопка назад поверх галереи (прототип).
  useLayoutEffect(() => { navigation.setOptions({ headerShown: false }); }, [navigation]);

  const load = useCallback(async (isAlive: () => boolean = () => true) => {
    try {
      const card = await fetchCard(cardId);
      if (!isAlive()) return;
      if (!card) { setError('Карточка не найдена.'); return; }
      const [photos, rows, age, parent, myLabels] = await Promise.all([
        fetchScanPhotos(card.scan_id).catch((e) => { logError('card.photos', e); return [] as CardPhoto[]; }),
        fetchScanResults(card.scan_id).catch((e) => { logError('card.results', e); return []; }),
        fetchAgeRange(card.cell_id),
        card.parent_card_id ? fetchCard(card.parent_card_id).catch(() => null) : Promise.resolve(null),
        // Своя метка не критична для показа карточки — сетевой отказ не должен блокировать остальное (как фото/результаты выше).
        fetchMyLabels(card.scan_id).catch((e) => { logError('card.myLabel', e); return [] as MyLabelRow[]; }),
      ]);
      if (!isAlive()) return;
      setData({
        card, photos, history: versionHistory(rows),
        identification: cardIdentification(card, rows), identificationBefore: identificationBefore(rows),
        split: card.split_recommended ?? splitRecommended(rows), age, parent,
        myLabel: latestLabel(myLabels),
      });
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

  // Разовый перенос локальной витрины (T6.0 §2.2): молча публиковать нельзя — спрашиваем один раз за
  // время жизни приложения, независимо от того, какую карточку открыли первой. Раз за монтирование экрана
  // (не за фокус) — иначе диалог лез бы при каждом возврате назад, пока флаг не запишется на диск.
  useEffect(() => {
    if (migrationChecked.current) return;
    migrationChecked.current = true;
    let alive = true;
    void (async () => {
      try {
        if (await isShowcaseMigrationDone()) return;
        const oldList = await readShowcase();
        if (oldList.length === 0) { await markShowcaseMigrationDone(); return; }
        const cards = await listAllCards().catch(() => []);
        if (!alive) return;
        const candidates = planShowcaseMigration(oldList, cards);
        await markShowcaseMigrationDone();
        if (!alive || candidates.length === 0) return;
        // Имя обещаем только если оно есть — как в диалоге одиночной публикации. Неизвестность (сеть)
        // трактуем как «имени нет»: лучше не пообещать подпись, чем пообещать несуществующую.
        let hasName = false;
        try { hasName = Boolean((await fetchProfile()).displayName); } catch (e) { logError('showcase.migration.profile', e); }
        if (!alive) return;
        Alert.alert(
          'Перенести старую витрину?',
          `В старой локальной витрине: ${cardsCountText(candidates.length)}. Опубликовать их сейчас — ` +
            `другие увидят фото, породу, тир${hasName ? ', ваше имя' : ''} и точное место каждой находки. ` +
            'Убрать можно в любой момент, но то, что уже увидели, не отменить.',
          [
            { text: 'Не сейчас', style: 'cancel' },
            { text: 'Опубликовать', onPress: () => { void publishMigrated(candidates.map((c) => c.id)); } },
          ],
        );
      } catch (e) {
        logError('showcase.migration', e);
      }
    })();
    return () => { alive = false; };
  }, []);

  const publishMigrated = async (ids: string[]) => {
    const results = await Promise.allSettled(ids.map((id) => setPublished(id, true)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (data && ids.includes(data.card.id)) void load();
    if (failed > 0) {
      Alert.alert('Не всё получилось', `Опубликовано ${ids.length - failed} из ${ids.length}. Остальное можно опубликовать позже с карточки каждой находки.`);
    }
  };

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

  // Публикация (T6.1, витрина = публикация): оптимистичное переключение с откатом при ошибке сервера.
  // publishing гейтит кнопку (disabled+loading) — повторные тапы, пока запрос летит, не шлют дублей.
  const doPublish = async (next: boolean) => {
    if (!data || publishing) return;
    const prevCard = data.card;
    setPublishing(true);
    setData({ ...data, card: { ...prevCard, published: next, published_at: next ? new Date().toISOString() : null } });
    try {
      const status = await setPublished(prevCard.id, next);
      setData((d) => (d ? { ...d, card: { ...d.card, published: status.published, published_at: status.publishedAt } } : d));
    } catch (e) {
      logError('card.publish', e);
      setData((d) => (d ? { ...d, card: prevCard } : d)); // откат: сервер отказал или сети нет
      Alert.alert('Не получилось', toUserMessage(e, MSG.saveFailed));
    } finally {
      setPublishing(false);
    }
  };

  // Диалог первой публикации — полный текст один раз (consent-copy.md §3a), дальше короткий (§3b).
  // Сборка текста — в lib/publish-copy.ts под тестами: экран тестами не покрыт, а обрезать согласие нельзя.
  const confirmPublish = async () => {
    if (!data || publishing) return;
    const card = data.card;
    const explained = await isPublishExplained();
    let hasName = false;
    if (!explained) {
      // Имя не удалось прочитать — берём вариант «имени нет»: он ничего не обещает про подпись, тогда как
      // основной текст утверждал бы, что другим видно имя. Ошибаться нужно в сторону меньшего обещания.
      try { hasName = Boolean((await fetchProfile()).displayName); } catch (e) { logError('card.publish.profile', e); }
    }
    const copy = publishDialogCopy({ explained, hasName, hasGeo: Boolean(card.cell_id) });
    Alert.alert(copy.title, copy.body, [
      { text: copy.cancel, style: 'cancel' },
      {
        text: copy.confirm,
        onPress: () => {
          // Флаг «объяснено» ставится по подтверждению, а не по показу: закрывший диалог отменой должен
          // в следующий раз снова увидеть полный текст, а не короткий (ревью потока E1).
          if (!explained) void markPublishExplained();
          void doPublish(true);
        },
      },
    ]);
  };

  const onTogglePublish = () => {
    if (!data || publishing) return;
    if (data.card.published) {
      Alert.alert(UNPUBLISH_DIALOG.title, UNPUBLISH_DIALOG.body, [
        { text: UNPUBLISH_DIALOG.cancel, style: 'cancel' },
        { text: UNPUBLISH_DIALOG.confirm, style: 'destructive', onPress: () => { void doPublish(false); } },
      ]);
    } else {
      void confirmPublish();
    }
  };

  // T7.1, поток B: своя метка (lithos.labels через lib/labels.ts) — личная отметка, не меняет card.verification
  // (сервер, 0014). labelAction гейтит обе кнопки разом, чтобы двойной тап не отправил вторую запись, пока
  // первая летит; сервер и так идемпотентен (upsert по scan_id+source+author_id), но незачем платить дважды.
  const confirmVerdict = async () => {
    if (!data || labelAction) return;
    setLabelAction('confirm');
    try {
      await recordLabel(data.card.scan_id, 'user_confirm', data.card.rock_class as RockClass);
      setData((d) => (d ? { ...d, myLabel: { source: 'user_confirm', rockClass: d.card.rock_class as RockClass, matchedModel: true, createdAt: new Date().toISOString() } } : d));
      Alert.alert(LABEL_FEEDBACK.confirmTitle, LABEL_FEEDBACK.confirmBody, [{ text: LABEL_FEEDBACK.ok }]);
    } catch (e) {
      logError('card.label.confirm', e);
      Alert.alert('Не получилось', toUserMessage(e, MSG.saveFailed));
    } finally {
      setLabelAction(null);
    }
  };

  const selectCorrection = async (rockClass: RockClass) => {
    if (!data || labelAction) return;
    setPickerOpen(false);
    setPickerQuery('');
    setLabelAction('correct');
    try {
      const result = await recordLabel(data.card.scan_id, 'user_correct', rockClass);
      setData((d) => (d ? { ...d, myLabel: { source: 'user_correct', rockClass, matchedModel: result.matchedModel, createdAt: new Date().toISOString() } } : d));
      Alert.alert(LABEL_FEEDBACK.correctTitle, LABEL_FEEDBACK.correctBody, [{ text: LABEL_FEEDBACK.ok }]);
    } catch (e) {
      logError('card.label.correct', e);
      Alert.alert('Не получилось', toUserMessage(e, MSG.saveFailed));
    } finally {
      setLabelAction(null);
    }
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

  const { card, photos, history, identification, identificationBefore: wasBefore, split, age, parent, myLabel } = data;
  const pending = card.verification === 'pending_review';
  const accent = pending ? colors.textFaint : tierColor(card.tier);
  const shape = shapeSummary(card.shape);
  const composition = inclusionLines(card.inclusions);
  const delta = card.parent_card_id ? splitDelta(card, parent?.score) : null;
  const canSplit = split && card.state === 'closed' && !card.hidden;
  // Публикация: сервер (lithos.publish_card) заведомо отклонит hidden (раскол) и pending_review — не предлагаем.
  const canPublish = !card.hidden && !pending;
  // Своя метка (T7.1): сервер (lithos.record_label) отклоняет ту же пару hidden/pending_review — не предлагаем.
  const canLabel = !card.hidden && !pending;
  const autoName = card.name?.trim() || rockClassRu(card.rock_class);
  const lines = historyLines({
    history, before: wasBefore, provisional: card.provisional, verification: card.verification,
    parent: parent ? { id: parent.id, name: displayName(parent), score: parent.score } : null,
  });

  const closePicker = () => { setPickerOpen(false); setPickerQuery(''); };

  return (
    <>
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

          {/* T7.1, поток B: своя метка — личная отметка, отдельно от строки статуса проверки выше (VERIFICATION_RU). */}
          {canLabel && (
            <View style={styles.labelBlock}>
              {myLabel && (
                <Note tone="neutral">
                  {(myLabel.source === 'user_confirm' ? LABEL_STATUS.confirmedPrefix : LABEL_STATUS.correctedPrefix) + rockClassRu(myLabel.rockClass)}
                </Note>
              )}
              <View style={styles.labelButtons}>
                <BigButton
                  label={LABEL_ACTIONS.confirm}
                  variant="secondary"
                  onPress={() => { void confirmVerdict(); }}
                  disabled={labelAction !== null}
                  loading={labelAction === 'confirm'}
                  style={styles.labelBtn}
                />
                <BigButton
                  label={LABEL_ACTIONS.correct}
                  variant="ghost"
                  onPress={() => setPickerOpen(true)}
                  disabled={labelAction !== null}
                  loading={labelAction === 'correct'}
                  style={styles.labelBtn}
                />
              </View>
              <Text style={styles.labelHint}>{LABEL_ACTIONS.hint}</Text>
            </View>
          )}
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
          {canPublish && (
            <BigButton
              label={card.published ? 'Убрать из витрины' : 'Опубликовать'}
              variant="secondary"
              onPress={onTogglePublish}
              disabled={publishing}
              loading={publishing}
            />
          )}
          {canPublish && <Note style={styles.noteCenter}>{card.published ? SHOWCASE_HINT.published : SHOWCASE_HINT.notPublished}</Note>}
          <BigButton label="В коллекцию" onPress={() => navigation.navigate('Tabs', { screen: 'Collection' }, { pop: true })} />
        </View>
      </View>
    </ScrollView>

    {/* Пикер породы («Это другая порода») — шторка снизу, тот же паттерн, что MapScreen/PublicFindScreen. */}
    <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={closePicker}>
      <Pressable style={styles.sheetBackdrop} onPress={closePicker} accessibilityRole="button" accessibilityLabel="Закрыть выбор породы" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.sheetGrip} />
        <Text style={styles.sheetTitle}>{LABEL_PICKER.title}</Text>
        <TextInput
          value={pickerQuery}
          onChangeText={setPickerQuery}
          placeholder={LABEL_PICKER.searchPlaceholder}
          placeholderTextColor={colors.textDim}
          style={styles.pickerInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {filteredPickerGroups.length === 0 ? (
            <Text style={styles.pickerEmpty}>{LABEL_PICKER.empty}</Text>
          ) : (
            filteredPickerGroups.map((g) => (
              <View key={g.key} style={styles.pickerGroup}>
                <SectionLabel>{g.title}</SectionLabel>
                {g.items.map((it) => (
                  <Pressable
                    key={it.code}
                    onPress={() => { void selectCorrection(it.code); }}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
                  >
                    <Text style={[styles.pickerItemText, myLabel?.rockClass === it.code && { color: colors.accentBright }]}>{it.nameRu}</Text>
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </ScrollView>
        <Text style={styles.pickerFootnote}>{LABEL_PICKER.footnote}</Text>
        <Pressable onPress={closePicker} accessibilityRole="button" style={styles.sheetCancel}>
          <Text style={styles.link}>{LABEL_PICKER.cancel}</Text>
        </Pressable>
      </View>
    </Modal>
    </>
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
  photo: { width: PHOTO_W, height: PHOTO_H, borderRadius: 18, backgroundColor: placeholderStripes.a, overflow: 'hidden' },
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
  // T7.1, поток B: своя метка (Подтвердить вердикт / Это другая порода) + шторка выбора породы.
  labelBlock: { gap: 9, paddingTop: 2 },
  labelButtons: { flexDirection: 'row', gap: 9 },
  labelBtn: { flex: 1 },
  labelHint: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, color: colors.textDim },
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,15,20,0.6)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%', backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderTopWidth: 1, borderColor: colors.divider, paddingTop: 10, paddingHorizontal: 16, gap: 10 },
  sheetGrip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 22, color: colors.text },
  pickerInput: { paddingVertical: 11, paddingHorizontal: 13, borderRadius: 12, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.divider, color: colors.text, fontFamily: fonts.sans, fontSize: 14 },
  sheetList: { flexGrow: 0 },
  sheetListContent: { gap: 4, paddingBottom: 4 },
  pickerGroup: { gap: 6, marginBottom: 10 },
  sheetRow: { paddingVertical: 11, paddingHorizontal: 13, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.divider },
  sheetRowPressed: { opacity: 0.8 },
  pickerItemText: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 18, color: colors.text },
  pickerEmpty: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 18, color: colors.textMuted, paddingVertical: 20, textAlign: 'center' },
  pickerFootnote: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, color: colors.textDim },
  sheetCancel: { alignSelf: 'center', paddingVertical: 12 },
  link: { fontFamily: fonts.sansSemi, fontSize: 14, lineHeight: 18, color: colors.accentBright },
});
