// Композиция «Отказ / особое» (DESIGN_SYSTEM.md, экран 8): карточка с полосой 150px и кружком-глифом,
// заголовок Playfair 22, тело 14.5 textMuted; primary + необязательная secondary. Отказ держит ритм карточки.
import { StyleSheet, Text, View } from 'react-native';
import type { RefusalView } from '../lib/result-text';
import { colors, fonts, radius } from '../theme';
import { BigButton } from './BigButton';
import { FadeIn } from './FadeIn';

interface Action {
  label: string;
  onPress: () => void;
}

interface Props {
  view: Pick<RefusalView, 'glyph' | 'title' | 'hint' | 'tone'>;
  primary: Action;
  secondary?: Action | null;
  /** Подпись под кнопками (например, «Это пересъёмка раскола…»). */
  note?: string | null;
}

export function Refusal({ view, primary, secondary, note }: Props) {
  const danger = view.tone === 'danger';
  const border = danger ? 'rgba(176,58,46,0.5)' : 'rgba(242,244,246,0.12)';
  const accent = danger ? colors.dangerAccent : colors.textMuted;
  return (
    <FadeIn duration={300} rise={10} style={styles.wrap}>
      <View style={[styles.card, { borderColor: border }]}>
        <View style={styles.band}>
          <View style={[styles.glyphCircle, { borderColor: border }]}>
            <Text style={[styles.glyph, { color: accent }]}>{view.glyph}</Text>
          </View>
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{view.title}</Text>
          <Text style={styles.text}>{view.hint}</Text>
        </View>
      </View>
      <View style={styles.buttons}>
        <BigButton label={primary.label} onPress={primary.onPress} />
        {secondary ? <BigButton label={secondary.label} variant="secondary" onPress={secondary.onPress} /> : null}
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  card: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1 },
  band: { height: 150, alignItems: 'center', justifyContent: 'center', backgroundColor: '#171d26' },
  glyphCircle: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontFamily: fonts.monoBold, fontSize: 22, lineHeight: 26 },
  body: { paddingTop: 20, paddingHorizontal: 18, paddingBottom: 22, gap: 12 },
  title: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 29, color: colors.text },
  text: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 22, color: colors.textMuted },
  buttons: { gap: 9 },
  note: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: colors.textDim, textAlign: 'center' },
});
