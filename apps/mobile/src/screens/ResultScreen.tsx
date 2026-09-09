// Экран результата (spec §4.3, dev-plan T2.2; DESIGN_SYSTEM.md экраны 5–8): Realtime/polling по scan_id →
// «Определяем…» (Analyzing) → карточка с пометкой «уточняем» (после Main) → финал (done). Отказы и особые
// состояния (пауза бюджета, нет связи, дольше обычного) — композиция Refusal по коду scans.error.
// Раскол (T2.3): финальный результат с родителем — экран «до и после» (CompareCard) вместо обычной карточки.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Analyzing } from '../components/Analyzing';
import { BigButton } from '../components/BigButton';
import { CompareCard } from '../components/CompareCard';
import { IdentificationList, IdentificationNote, IdentificationSkeleton } from '../components/IdentificationList';
import { Refusal } from '../components/Refusal';
import { CardFrame, DeltaPill, FactRow, LegendaryGlow, Note, PhotoPlaceholder, TierLine } from '../components/ui';
import { cardFacts, displayName, rockClassRu, splitDelta } from '../lib/card-facts';
import type { CardRow, ScanResultRow } from '../lib/card-types';
import { type CardPhoto, fetchCard, fetchScanPhotos, fetchScanResults } from '../lib/cards';
import { logError } from '../lib/errors';
import { splitRecommended } from '../lib/history';
import { cardIdentification } from '../lib/identification-view';
import { isCardCollected, markCardCollected } from '../lib/prefs';
import { REFUSAL_ACTION_LABEL, refusalView, type RefusalAction, RESULT_MSG, RESULT_TIMEOUT_MS, resultPhase, type SpecialKind, specialView } from '../lib/result-text';
import { useScanWatch } from '../lib/scan-watch';
import type { RootStackParamList } from '../navigation/types';
import { useSplitFlow } from '../navigation/useSplitFlow';
import { colors, fonts, placeholderStripes, spacing, tierColor } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Result'>;

const TIER_NAME_RU: Record<NonNullable<CardRow['tier']>, string> = {
  common: 'Обычный', uncommon: 'Необычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный',
};

function tierNameText(tier: CardRow['tier']): string {
  return tier ? TIER_NAME_RU[tier] : 'Без редкости';
}
function scoreDisplay(card: Pick<CardRow, 'score' | 'verification'>): string {
  if (card.verification === 'pending_review') return '?';
  return card.score === null ? '—' : String(card.score);
}

/** Пульсирующая точка в плашке «Уточняем» (прототип: `lpulse`, opacity .3↔1). */
function PulseDot() {
  const v = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 550, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.3, duration: 550, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[styles.pulseDot, { opacity: v }]} />;
}

export function ResultScreen({ navigation, route }: Props) {
  const { scanId } = route.params;
  const { scan, card, error, gaveUp, reload } = useScanWatch(scanId);
  const phase = resultPhase(scan?.stage ?? null, card !== null, scan?.error ?? null);
  const [slow, setSlow] = useState(false);
  // scan_results (запасной путь для старых карточек без meta); null — ещё не читали.
  const [rows, setRows] = useState<ScanResultRow[] | null>(null);
  const [parent, setParent] = useState<CardRow | null>(null);
  const [collected, setCollected] = useState(false);
  const [photos, setPhotos] = useState<CardPhoto[] | null>(null);
  const insets = useSafeAreaInsets();
  const goSplit = useSplitFlow();

  // 90 с без карточки → «обрабатываем дольше обычного» (ai-pipeline §7), наблюдение продолжается.
  // Сбрасывается при «Обновить» (reloadKey).
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    setSlow(false);
    const t = setTimeout(() => setSlow(true), RESULT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [scanId, reloadKey]);
  const retry = () => { setReloadKey((k) => k + 1); reload(); };

  // Кандидаты определения и рекомендация раскола — из самой карточки (score_breakdown.meta, воркер T2.1/T5.0):
  // ни запроса, ни гонки с watcher'ом; после escalation карточка приходит новой и список обновляется сам.
  // scan_results — только запасной путь для старых карточек без meta, и тогда один раз, не на каждый тик.
  const needsRows = card !== null && (card.identification === null || card.split_recommended === null);
  useEffect(() => {
    if (!needsRows) return;
    let alive = true;
    fetchScanResults(scanId)
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { logError('result.results', e); if (alive) setRows([]); });
    return () => { alive = false; };
  }, [scanId, needsRows]);
  const identification = useMemo(() => (card ? cardIdentification(card, rows) : null), [card, rows]);
  const rowsSplit = useMemo(() => (rows ? splitRecommended(rows) : false), [rows]);
  const split = card?.split_recommended ?? rowsSplit;

  // Лицевое фото скана (не блокирует карточку — пока грузится, полосатый плейсхолдер).
  useEffect(() => {
    let alive = true;
    fetchScanPhotos(scanId).then((p) => { if (alive) setPhotos(p); }).catch((e) => { logError('result.photos', e); if (alive) setPhotos([]); });
    return () => { alive = false; };
  }, [scanId]);

  // Раскол: родительская карточка для дельты score и мини-карточки «до».
  const parentId = scan?.parent_card_id ?? null;
  useEffect(() => {
    if (!parentId) return;
    let alive = true;
    fetchCard(parentId).then((c) => { if (alive) setParent(c); }).catch((e) => logError('result.parent', e));
    return () => { alive = false; };
  }, [parentId]);

  const cardId = card?.id ?? null;
  useEffect(() => {
    if (!cardId) return;
    let alive = true;
    isCardCollected(cardId).then((v) => { if (alive) setCollected(v); });
    return () => { alive = false; };
  }, [cardId]);

  const toCollection = () => {
    if (card) { void markCardCollected(card.id); setCollected(true); }
    navigation.navigate('Tabs', { screen: 'Collection' }, { pop: true });
  };
  const rescan = () => navigation.navigate('Tabs', { screen: 'Camera' }, { pop: true });
  // Раскол не удался (размыто/темно): камень уже расколот — пересъёмка остаётся расколом того же родителя.
  // Если родитель не найден (parent_not_found) — повтор с тем же родителем бессмыслен, начинаем обычный скан.
  const keepParent = parentId !== null && scan?.error !== 'parent_not_found';
  const retake = () => (keepParent && parentId ? navigation.navigate('Tabs', { screen: 'Camera', params: { parentCardId: parentId } }, { pop: true }) : rescan());
  const openCard = () => { if (card) navigation.navigate('Card', { cardId: card.id }); };

  const actionHandlers: Record<RefusalAction, () => void> = { retake, collection: toCollection, rescan, refresh: retry };
  const runAction = (a: RefusalAction) => actionHandlers[a]();
  const pad = { paddingBottom: insets.bottom + spacing.xl, paddingTop: insets.top + 14 };

  if (phase === 'failed') {
    const view = refusalView(scan?.error);
    return (
      <View style={[styles.center, pad]}>
        <Refusal
          view={view}
          primary={{ label: REFUSAL_ACTION_LABEL[view.primary], onPress: () => runAction(view.primary) }}
          secondary={view.secondary ? { label: REFUSAL_ACTION_LABEL[view.secondary], onPress: () => runAction(view.secondary!) } : null}
          note={keepParent ? 'Это пересъёмка раскола — исходная карточка останется связанной.' : null}
        />
      </View>
    );
  }

  if (!card) {
    // T3.4: бюджет исчерпан — воркер поставил скан на паузу (error='budget_paused', stage прежний). Не спиннер.
    if (phase === 'paused') {
      const view = refusalView('budget_paused');
      return (
        <View style={[styles.center, pad]}>
          <Refusal
            view={view}
            primary={{ label: REFUSAL_ACTION_LABEL[view.primary], onPress: () => runAction(view.primary) }}
            secondary={view.secondary ? { label: REFUSAL_ACTION_LABEL[view.secondary], onPress: () => runAction(view.secondary!) } : null}
          />
        </View>
      );
    }
    if (error) {
      const view = { glyph: '⌁', title: 'Нет связи', hint: error, tone: 'neutral' as const };
      return (
        <View style={[styles.center, pad]}>
          <Refusal view={view} primary={{ label: 'Обновить', onPress: retry }} secondary={{ label: 'Новый скан', onPress: rescan }} />
        </View>
      );
    }
    const specialKind: SpecialKind | null = slow || gaveUp ? 'slow' : null;
    if (specialKind) {
      const view = specialView(specialKind);
      return (
        <View style={[styles.center, pad]}>
          <Refusal
            view={view}
            primary={{ label: REFUSAL_ACTION_LABEL[view.primary], onPress: () => runAction(view.primary) }}
            secondary={view.secondary ? { label: REFUSAL_ACTION_LABEL[view.secondary], onPress: () => runAction(view.secondary!) } : null}
          />
        </View>
      );
    }
    return (
      <View style={styles.fill}>
        <Analyzing stage={scan?.stage ?? null} />
        {/* В прототипе кнопки на этом экране нет — подстраховка от зависшего анализа, не мешает композиции. */}
        <View style={[styles.escapeHatch, { bottom: insets.bottom + 18 }]}>
          <BigButton label="Новый скан" variant="ghost" onPress={rescan} />
        </View>
      </View>
    );
  }

  // Раскол завершён: своя композиция «до и после» вместо обычной карточки (DESIGN_SYSTEM.md, экран 7).
  if (phase === 'done' && parentId && parent && card.state === 'opened') {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={[styles.content, pad]}>
        <CompareCard
          parent={parent}
          child={card}
          parentTier={parent.tier}
          onOpenCard={openCard}
          onCollection={toCollection}
          onRescan={rescan}
        />
      </ScrollView>
    );
  }

  const facts = cardFacts(card);
  const refining = phase === 'refining';
  const accent = card.verification === 'pending_review' ? tierColor(null) : tierColor(card.tier);
  // Дельта раскола (T2.3) — после финала, если по какой-то причине не попали в ветку Compare выше (нет parent).
  const delta = phase === 'done' && parentId ? splitDelta(card, parent?.score) : null;
  const canSplit = split && card.state === 'closed' && !card.hidden;
  const primaryPhoto = photos && photos.length > 0 ? photos[0] : null;

  const note = card.verification === 'pending_review'
    ? 'Тир «?» — гео-аномалия ушла на ревью. Порода здесь не встречается.'
    : card.score === null
      ? 'Без редкости — скан без геопозиции. Порода и лор есть, score не считаем.'
      : card.provisional
        ? 'Предварительно — результат от резервного провайдера. Тир ограничен «Редким», позже пересчитается.'
        : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, pad]}>
      <CardFrame tier={card.tier} refining={refining}>
        {card.tier === 'legendary' && !refining && <LegendaryGlow replayKey={card.id} />}
        <View style={styles.photo}>
          {primaryPhoto ? (
            <Image source={{ uri: primaryPhoto.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <PhotoPlaceholder label="фото камня" height={206} style={styles.photoFill} />
          )}
          {refining && (
            <View style={styles.refiningPill}>
              <PulseDot />
              <Text style={styles.refiningText}>{RESULT_MSG.refining}</Text>
            </View>
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.titleBlock}>
            <Text style={styles.name}>{displayName(card)}</Text>
            {identification ? (
              <IdentificationList view={identification} accent={accent} />
            ) : card.identification === null && rows === null ? (
              <IdentificationSkeleton />
            ) : (
              <Text style={styles.rock}>{rockClassRu(card.rock_class)}</Text>
            )}
          </View>

          <TierLine tierName={tierNameText(card.tier)} tier={card.tier} scoreText={scoreDisplay(card)} pendingReview={card.verification === 'pending_review'} />

          {note && <Note tone="gold">{note}</Note>}
          {delta && <DeltaPill text={`После раскола: ${delta.text}`} negative={delta.sign === 'down'} />}
          {identification && <IdentificationNote />}

          <View style={styles.facts}>
            {facts.map((f) => <FactRow key={f.label}>{f.value}</FactRow>)}
          </View>

          {card.lore ? (
            <View style={styles.loreBlock}>
              <Text style={styles.lore}>{card.lore}</Text>
            </View>
          ) : null}
        </View>
      </CardFrame>

      <View style={styles.buttons}>
        <BigButton label={collected ? 'В коллекции' : 'В коллекцию'} onPress={toCollection} />
        <View style={styles.row}>
          <BigButton label="Открыть карточку" variant="secondary" onPress={openCard} style={styles.half} />
          <BigButton label="Новый скан" variant="secondary" onPress={rescan} style={styles.half} />
        </View>
        {canSplit && <BigButton label="Расколоть и пересканировать" variant="danger" onPress={() => { void goSplit(card.id); }} />}
      </View>
      <Text style={styles.saved}>{RESULT_MSG.saved}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, gap: 18 },
  center: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, justifyContent: 'center' },
  escapeHatch: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  photo: { height: 206, backgroundColor: placeholderStripes.a },
  photoFill: { height: 206, borderRadius: 0 },
  refiningPill: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(11,15,20,0.82)', borderWidth: 1, borderColor: 'rgba(242,244,246,0.14)' },
  pulseDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.accentBright },
  refiningText: { fontFamily: fonts.sansSemi, fontSize: 12, lineHeight: 14, color: colors.text },
  body: { padding: 19, gap: 19 },
  titleBlock: { gap: 5 },
  name: { fontFamily: fonts.serif, fontSize: 24, lineHeight: 29, color: colors.text },
  rock: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 19, color: colors.textMuted },
  facts: { gap: 11 },
  loreBlock: { paddingTop: 2, borderTopWidth: 1, borderTopColor: colors.divider },
  lore: { fontFamily: fonts.serifRegular, fontSize: 15, lineHeight: 23, color: colors.textSoft, marginTop: 13 },
  buttons: { gap: 9 },
  row: { flexDirection: 'row', gap: 9 },
  half: { flex: 1 },
  saved: { textAlign: 'center', fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, color: colors.textDim },
});
