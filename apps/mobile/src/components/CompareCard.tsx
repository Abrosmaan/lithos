// Композиция «Раскол: до и после» (DESIGN_SYSTEM.md, экран 7): вместо обычного результата — когда карточка
// финальна (state='opened') и есть родитель. Данные — compareCards(parent, child) из lib/compare.ts, чистая
// разность breakdown; ни одного балансового числа здесь, только оформление и mono-подписи очков.
import type { Tier } from '@lithos/shared';
import { StyleSheet, Text, View } from 'react-native';
import { compareCards, type CompareCard as CompareCardInput } from '../lib/compare';
import { rockClassRu, tierLabel } from '../lib/card-facts';
import { colors, fonts, placeholderStripes, radius, tierColor } from '../theme';
import { BigButton } from './BigButton';
import { FadeIn } from './FadeIn';
import { DeltaPill, SectionLabel } from './ui';

interface Props {
  parent: CompareCardInput;
  child: CompareCardInput & { tier: Tier | null };
  parentTier: Tier | null;
  onOpenCard: () => void;
  onCollection: () => void;
  onRescan: () => void;
}

/** Мини-карточка «до» / «после»: полоса-плейсхолдер + шов тира + порода/тир/score. */
function MiniCard({ label, rockClass, tier, score, dim }: { label: string; rockClass: string; tier: Tier | null; score: number | null; dim?: boolean }) {
  const color = tierColor(tier);
  return (
    <View style={[styles.mini, { borderColor: dim ? colors.divider : color }, dim && styles.miniDim]}>
      <View style={styles.miniPhoto}>
        <Text style={styles.miniWhen}>{label}</Text>
        <View style={[styles.miniSeam, { backgroundColor: color }]} />
      </View>
      <View style={styles.miniBody}>
        <Text style={styles.miniRock} numberOfLines={1}>{rockClassRu(rockClass)}</Text>
        <Text style={[styles.miniTier, { color }]} numberOfLines={1}>{tierLabel(tier)}</Text>
        <View style={styles.miniScoreRow}>
          <Text style={styles.miniScore}>{score ?? '—'}</Text>
          <Text style={styles.miniDenom}>/ 100</Text>
        </View>
      </View>
    </View>
  );
}

export function CompareCard({ parent, child, parentTier, onOpenCard, onCollection, onRescan }: Props) {
  const view = compareCards(parent, child);
  const deltaNegative = view.sign === 'down';
  return (
    <FadeIn duration={320} rise={12} style={styles.wrap}>
      <View style={styles.head}>
        <SectionLabel color={colors.textDim}>камень расколот</SectionLabel>
        <Text style={styles.headline}>{view.headline}</Text>
      </View>

      <View style={styles.sides}>
        <MiniCard label="до раскола" rockClass={parent.rock_class} tier={parentTier} score={parent.score} dim />
        <MiniCard label="после раскола" rockClass={child.rock_class} tier={child.tier} score={child.score} />
      </View>

      {view.delta && (
        <FadeIn delay={300} style={styles.deltaBlock}>
          <DeltaPill text={view.delta.text} negative={deltaNegative} />
          <Text style={styles.deltaNote}>{view.deltaNote}</Text>
        </FadeIn>
      )}

      {view.changes.length > 0 && (
        <FadeIn delay={420} style={styles.changes}>
          <SectionLabel>Что изменилось в разборе</SectionLabel>
          {view.changes.map((c) => (
            <View key={c.label} style={styles.changeRow}>
              <Text style={[styles.changePts, c.sign === 'up' ? styles.up : c.sign === 'down' ? styles.down : styles.same]}>{c.pts}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.changeLabel}>{c.label}</Text>
                <Text style={styles.changeWhy}>{c.why}</Text>
              </View>
            </View>
          ))}
        </FadeIn>
      )}

      <Text style={styles.footnote}>Закрытая версия карточки исчезла — осталась раскрытая. Ссылка «До раскола» ведёт на родительскую карточку.</Text>

      <View style={styles.buttons}>
        <BigButton label="Открыть карточку" onPress={onOpenCard} />
        <View style={styles.row}>
          <BigButton label="В коллекцию" variant="secondary" onPress={onCollection} style={styles.half} />
          <BigButton label="Новый скан" variant="secondary" onPress={onRescan} style={styles.half} />
        </View>
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  head: { gap: 6 },
  headline: { fontFamily: fonts.serif, fontSize: 26, lineHeight: 31, color: colors.text },
  sides: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  mini: { flex: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1 },
  miniDim: { opacity: 0.55 },
  miniPhoto: { height: 118, backgroundColor: placeholderStripes.a, justifyContent: 'flex-start' },
  miniWhen: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: 'rgba(11,15,20,0.8)', fontFamily: fonts.sansSemi, fontSize: 10, lineHeight: 12, color: colors.chipText },
  miniSeam: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  miniBody: { padding: 12, paddingTop: 12, gap: 6 },
  miniRock: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 16, color: colors.textMuted },
  miniTier: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 18 },
  miniScoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  miniScore: { fontFamily: fonts.monoBold, fontSize: 26, lineHeight: 28, color: colors.text },
  miniDenom: { fontFamily: fonts.sans, fontSize: 11, color: colors.textDim },
  deltaBlock: { gap: 5 },
  deltaNote: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: colors.textMuted },
  changes: { gap: 9 },
  changeRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 13, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  changePts: { width: 44, flexShrink: 0, fontFamily: fonts.monoBold, fontSize: 13, lineHeight: 17 },
  up: { color: colors.accentSoft },
  down: { color: colors.dangerText },
  same: { color: colors.textMuted },
  changeLabel: { fontFamily: fonts.sansSemi, fontSize: 13.5, lineHeight: 17, color: colors.text },
  changeWhy: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: colors.textMuted },
  footnote: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: colors.textDim },
  buttons: { gap: 9 },
  row: { flexDirection: 'row', gap: 9 },
  half: { flex: 1 },
});
