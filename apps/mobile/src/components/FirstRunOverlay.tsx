// Оверлей первого запуска на камере (DESIGN_SYSTEM.md, экран 3): overlay `colors.overlay`, mono-лейбл
// «первый камень», Playfair 27, три шага с кружками-номерами, primary «Понятно». Тексты — из прототипа (firstRunSteps).
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '../theme';
import { BigButton } from './BigButton';
import { FadeIn } from './FadeIn';
import { SectionLabel, StepNumber } from './ui';

export const FIRST_RUN_STEPS = [
  'Снимите камень крупно, на нейтральном фоне — не в горсти с другими.',
  'Одно фото сделайте с монетой или пальцем рядом: так мы поймём размер и добавим очков.',
  'Через несколько секунд получите карточку: породу, редкость и историю камня.',
] as const;

export function FirstRunOverlay({ onDismiss }: { onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <FadeIn duration={350} rise={0} style={[StyleSheet.absoluteFill, styles.overlay, { paddingTop: insets.top + 54, paddingBottom: insets.bottom + 26 }]}>
      <View style={styles.head}>
        <SectionLabel color={colors.accentBright} style={styles.label}>первый камень</SectionLabel>
        <Text style={styles.h2}>Снимите камень — получите карточку</Text>
      </View>
      <View style={styles.steps}>
        {FIRST_RUN_STEPS.map((text, i) => (
          <View key={text} style={styles.step}>
            <StepNumber n={i + 1} />
            <Text style={styles.stepText}>{text}</Text>
          </View>
        ))}
      </View>
      <BigButton label="Понятно" onPress={onDismiss} />
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: colors.overlay, justifyContent: 'flex-end', gap: 20, paddingHorizontal: 22, zIndex: 5 },
  head: { gap: 9 },
  label: { letterSpacing: 1.8 },
  h2: { fontFamily: fonts.serif, fontSize: 27, lineHeight: 32, color: colors.text },
  steps: { gap: 13 },
  step: { flexDirection: 'row', gap: 13, alignItems: 'flex-start' },
  stepText: { flex: 1, fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 21, color: colors.textSoft },
});
