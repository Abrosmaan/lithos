// Список кандидатов определения (UX как в iNaturalist, T5.1) в языке прототипа (DESIGN_SYSTEM.md, «Что в прототипе
// не учтено»): строки «имя · N %» — имя primary Playfair, остальные Golos textMuted, проценты mono, под строкой
// полоска 3px пропорционально проценту. Заголовок по уверенности («Уверены: это базальт») — по желанию экрана.
// Текст строки дублирует полоску — цвет и длина не единственный носитель; у каждой строки своя подпись для скринридера.
import { StyleSheet, Text, View } from 'react-native';
import { IDENTIFICATION_NOTE, type IdentificationView } from '../lib/identification-view';
import { colors, fonts, radius } from '../theme';

interface Props {
  view: IdentificationView;
  /** Цвет полоски основного варианта — цвет тира карточки или акцент. */
  accent?: string;
  /** Показывать заголовок по уверенности над списком (карточка — да; результат ставит его строкой породы сам). */
  showHeadline?: boolean;
}

export function IdentificationList({ view, accent = colors.accentBright, showHeadline = true }: Props) {
  return (
    <View style={styles.wrap}>
      {showHeadline ? <Text style={styles.headline}>{view.headline}</Text> : null}
      {view.candidates.map((c) => {
        const other = c.rock_class === 'other';
        const fill = c.is_primary ? accent : other ? colors.borderStrong : colors.textDim;
        return (
          <View key={c.rock_class} style={[styles.row, other && styles.rowOther]} accessible accessibilityLabel={c.accessibilityLabel}>
            <View style={styles.line}>
              <Text style={[styles.name, c.is_primary && styles.namePrimary]} numberOfLines={1}>{c.name_ru}</Text>
              <Text style={styles.percent}>{c.percent} %</Text>
            </View>
            <View style={styles.track} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
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

/** Подпись «вероятность определения, не состав» — 12.5 textDim, под списком. */
export function IdentificationNote() {
  return <Text style={styles.note}>{IDENTIFICATION_NOTE}</Text>;
}

/** Место под две строки списка, пока scan_results (запасной путь) грузятся — вёрстка не прыгает. */
export function IdentificationSkeleton() {
  return (
    <View style={styles.wrap} accessible accessibilityLabel="Загружаем определение">
      <View style={styles.row}>
        <View style={[styles.bone, styles.bonePrimary]} />
        <View style={styles.track} />
      </View>
      <View style={styles.row}>
        <View style={[styles.bone, styles.boneLine]} />
        <View style={styles.track} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 9 },
  headline: { fontFamily: fonts.sansSemi, fontSize: 14, lineHeight: 19, color: colors.textMuted },
  row: { gap: 4 },
  rowOther: { opacity: 0.6 },
  line: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  name: { flex: 1, fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 18, color: colors.textMuted },
  namePrimary: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 20, color: colors.text },
  percent: { fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 16, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  track: { height: 3, borderRadius: radius.full, backgroundColor: colors.track, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: radius.full },
  reason: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, color: colors.textDim, fontStyle: 'italic' },
  note: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: colors.textDim },
  bone: { backgroundColor: colors.surface2, borderRadius: radius.xs },
  bonePrimary: { height: 20, width: '45%' },
  boneLine: { height: 18, width: '35%' },
});
