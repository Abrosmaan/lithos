// Список кандидатов определения (UX как в iNaturalist): заголовок по уверенности, primary крупно с полоской цвета
// тира, остальные — тонкими полосками пропорционально проценту, «другое» последним приглушённо. Текст строки
// («Базальт · 80 %», единый формат из identification-view) дублирует полоску — цвет и длина не единственный
// носитель; у каждой строки своя подпись для скринридера. Подпись про вероятность (IdentificationNote) экраны
// ставят под score/тир, чтобы не рвать hero; IdentificationSkeleton держит место, пока запасной путь грузится.
import { StyleSheet, Text, View } from 'react-native';
import { IDENTIFICATION_NOTE, type IdentificationView } from '../lib/identification-view';
import { colors, radius, spacing } from '../theme';

interface Props {
  view: IdentificationView;
  /** Цвет полоски основного варианта — цвет тира карточки или акцент. */
  accent?: string;
}

export function IdentificationList({ view, accent = colors.accent }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.headline}>{view.headline}</Text>
      {view.candidates.map((c) => {
        const other = c.rock_class === 'other';
        const fill = c.is_primary ? accent : other ? colors.border : colors.textMuted;
        return (
          <View key={c.rock_class} style={[styles.row, other && styles.rowOther]} accessible accessibilityLabel={c.accessibilityLabel}>
            <Text style={[styles.label, c.is_primary && styles.labelPrimary, other && styles.labelOther]} numberOfLines={1}>{c.label}</Text>
            <View style={[styles.track, c.is_primary && styles.trackPrimary]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <View style={[styles.bar, { width: `${c.percent}%`, backgroundColor: fill }]} />
            </View>
            {/* reason — только если модель его дала; язык reason — забота промпта воркера (main-v3), клиент не переводит. */}
            {c.reason ? <Text style={styles.reason} numberOfLines={1}>{c.reason}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

/** Подпись «вероятность определения, не состав» — под score/тиром, одна на оба экрана. */
export function IdentificationNote() {
  return <Text style={styles.note}>{IDENTIFICATION_NOTE}</Text>;
}

/** Место под заголовок + две строки списка, пока scan_results (запасной путь) грузятся — вёрстка не прыгает. */
export function IdentificationSkeleton() {
  return (
    <View style={styles.wrap} accessible accessibilityLabel="Загружаем определение">
      <View style={[styles.bone, styles.boneHeadline]} />
      <View style={styles.row}>
        <View style={[styles.bone, styles.bonePrimary]} />
        <View style={[styles.track, styles.trackPrimary]} />
      </View>
      <View style={styles.row}>
        <View style={[styles.bone, styles.boneLine]} />
        <View style={styles.track} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headline: { color: colors.text, fontSize: 17, fontWeight: '700', lineHeight: 22 },
  row: { gap: 3 },
  rowOther: { opacity: 0.6 },
  label: { color: colors.text, fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'] },
  labelPrimary: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  labelOther: { color: colors.textMuted },
  track: { height: 4, borderRadius: radius.full, backgroundColor: colors.surfaceActive, overflow: 'hidden' },
  trackPrimary: { height: 8 },
  bar: { height: '100%', borderRadius: radius.full },
  reason: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  bone: { backgroundColor: colors.surfaceActive, borderRadius: radius.sm },
  boneHeadline: { height: 22, width: '60%' },
  bonePrimary: { height: 26, width: '45%' },
  boneLine: { height: 20, width: '35%' },
});
