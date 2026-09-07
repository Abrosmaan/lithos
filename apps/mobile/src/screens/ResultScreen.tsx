// Экран результата (spec §4.3, dev-plan T2.2): Realtime/polling по scan_id → «Определяем…» →
// карточка с пометкой «уточняем» (после Main) → финал (done). Отказы — по коду scans.error.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { TierBadge } from '../components/TierBadge';
import { cardFacts, displayName, rockClassRu, splitDelta } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { fetchCard, fetchScanResults } from '../lib/cards';
import { logError } from '../lib/errors';
import { splitRecommended } from '../lib/history';
import { isCardCollected, markCardCollected } from '../lib/prefs';
import { rejectText, RESULT_MSG, RESULT_TIMEOUT_MS, resultPhase, stageStatusText } from '../lib/result-text';
import { useScanWatch } from '../lib/scan-watch';
import type { RootStackParamList } from '../navigation/types';
import { useSplitFlow } from '../navigation/useSplitFlow';
import { colors, radius, spacing, tierColor } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Result'>;

export function ResultScreen({ navigation, route }: Props) {
  const { scanId } = route.params;
  const { scan, card, error, gaveUp, reload } = useScanWatch(scanId);
  const phase = resultPhase(scan?.stage ?? null, card !== null);
  const [slow, setSlow] = useState(false);
  const [split, setSplit] = useState(false);
  const [parent, setParent] = useState<CardRow | null>(null);
  const [collected, setCollected] = useState(false);
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

  // Рекомендация раскола — из scan_results (последний вердикт); перечитываем при смене ступени.
  // Рекомендация раскола: из breakdown.meta карточки (T2.1); если поля нет — из scan_results.
  const stage = scan?.stage ?? null;
  const cardUpdatedAt = card?.updated_at ?? null;
  const cardSplit = card?.split_recommended ?? null;
  useEffect(() => {
    if (!cardUpdatedAt) return;
    if (cardSplit !== null) { setSplit(cardSplit); return; }
    let alive = true;
    fetchScanResults(scanId)
      .then((rows) => { if (alive) setSplit(splitRecommended(rows)); })
      .catch((e) => logError('result.split', e));
    return () => { alive = false; };
  }, [scanId, stage, cardUpdatedAt, cardSplit]);

  // Раскол: родительская карточка для дельты score.
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
    navigation.navigate('Collection');
  };
  const rescan = () => navigation.popToTop();
  // Раскол не удался (размыто/темно): камень уже расколот — пересъёмка остаётся расколом того же родителя.
  // Если родитель не найден (parent_not_found) — повтор с тем же родителем бессмыслен, начинаем обычный скан.
  const keepParent = parentId !== null && scan?.error !== 'parent_not_found';
  const retake = () => (keepParent && parentId ? navigation.navigate('Camera', { parentCardId: parentId }) : rescan());
  const pad = { paddingBottom: insets.bottom + spacing.xl };

  if (phase === 'failed') {
    const t = rejectText(scan?.error);
    return (
      <View style={[styles.center, pad]}>
        <Text style={styles.h1}>{t.title}</Text>
        <Text style={styles.muted}>{t.hint}</Text>
        <BigButton label="Переснять" onPress={retake} style={styles.stretch} />
        {keepParent && <Text style={styles.muted}>Это пересъёмка раскола — исходная карточка останется связанной.</Text>}
        <BigButton label="В коллекцию" variant="secondary" onPress={toCollection} style={styles.stretch} />
      </View>
    );
  }

  if (!card) {
    if (error) {
      return (
        <View style={[styles.center, pad]}>
          <Text style={styles.h1}>Нет связи</Text>
          <Text style={styles.muted}>{error}</Text>
          <BigButton label="Обновить" onPress={retry} style={styles.stretch} />
          <BigButton label="Новый скан" variant="secondary" onPress={rescan} style={styles.stretch} />
        </View>
      );
    }
    if (slow || gaveUp) {
      return (
        <View style={[styles.center, pad]}>
          <Text style={styles.h1}>Обрабатываем дольше обычного</Text>
          <Text style={styles.muted}>{RESULT_MSG.slow}</Text>
          <BigButton label="В коллекцию" onPress={toCollection} style={styles.stretch} />
          <BigButton label="Новый скан" variant="secondary" onPress={rescan} style={styles.stretch} />
        </View>
      );
    }
    return (
      <View style={[styles.center, pad]}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.h1}>{RESULT_MSG.determining}</Text>
        <Text style={styles.muted}>{scan ? stageStatusText(scan.stage) : 'Подключаемся…'}</Text>
        <BigButton label="Новый скан" variant="secondary" onPress={rescan} style={styles.stretchGap} />
      </View>
    );
  }

  const facts = cardFacts(card);
  const accent = card.verification === 'pending_review' ? tierColor(null) : tierColor(card.tier);
  // Дельта раскола (T2.3) — после финала: breakdown.split_delta, иначе по родительской карточке.
  const delta = phase === 'done' && parentId ? splitDelta(card, parent?.score) : null;
  const canSplit = split && card.state === 'closed' && !card.hidden;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, pad]}>
      <View style={[styles.hero, { borderColor: accent }]}>
        <View style={styles.badges}>
          <TierBadge tier={card.tier} verification={card.verification} size="lg" />
          {stage === 'escalation' && <Tag text={RESULT_MSG.refining} color={colors.warning} />}
          {card.provisional && <Tag text={RESULT_MSG.provisional} color={colors.warning} />}
          {card.verification === 'pending_review' && <Tag text="На проверке" color={tierColor(null)} />}
        </View>
        <Text style={styles.name}>{displayName(card)}</Text>
        <Text style={styles.rock}>{rockClassRu(card.rock_class)}</Text>
        <Text style={[styles.score, { color: accent }]}>{card.score !== null ? `${card.score} очков` : 'без редкости — нет геопозиции'}</Text>
        {delta && (
          <Text style={[styles.delta, delta.sign === 'up' ? styles.deltaUp : delta.sign === 'down' ? styles.deltaDown : null]}>
            После раскола: {delta.text}
          </Text>
        )}
        {phase === 'refining' && (
          <Text style={styles.refine}>{stage === 'escalation' ? 'Проверяем вердикт второй моделью — карточка может уточниться.' : 'Досчитываем редкость — карточка может уточниться.'}</Text>
        )}
      </View>

      <View style={styles.facts}>
        {facts.map((f) => (
          <View key={f.label} style={styles.fact}>
            <Text style={styles.factLabel}>{f.label}</Text>
            <Text style={styles.factValue}>{f.value}</Text>
          </View>
        ))}
      </View>

      {card.lore ? <Text style={styles.lore}>{card.lore}</Text> : null}

      <BigButton label={collected ? 'В коллекции ✓' : 'В коллекцию'} onPress={toCollection} />
      <BigButton label="Открыть карточку" variant="secondary" onPress={() => navigation.navigate('Card', { cardId: card.id })} />
      {canSplit && (
        <BigButton label="Расколоть и пересканировать" variant="secondary" onPress={() => { void goSplit(card.id); }} />
      )}
      {canSplit && <Text style={styles.hint}>Снаружи обычный — внутри может быть что-то интересное.</Text>}
      <BigButton label="Новый скан" variant="secondary" onPress={rescan} />
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
  stretchGap: { alignSelf: 'stretch', marginTop: spacing.lg },
  h1: { color: colors.text, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  muted: { color: colors.textMuted, fontSize: 16, textAlign: 'center', lineHeight: 22 },
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, padding: spacing.lg, gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  name: { color: colors.text, fontSize: 28, fontWeight: '800', lineHeight: 34 },
  rock: { color: colors.textMuted, fontSize: 17 },
  score: { fontSize: 22, fontWeight: '700' },
  delta: { color: colors.text, fontSize: 16, fontWeight: '600' },
  deltaUp: { color: '#5ccb8a' },
  deltaDown: { color: '#f08a7c' },
  refine: { color: colors.textMuted, fontSize: 14 },
  facts: { gap: spacing.sm },
  fact: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  factLabel: { color: colors.textMuted, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  factValue: { color: colors.text, fontSize: 18, fontWeight: '600' },
  lore: { color: colors.text, fontSize: 16, lineHeight: 24 },
  hint: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: -spacing.sm },
  tag: { paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.full },
  tagText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
