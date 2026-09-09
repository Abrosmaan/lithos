// Безопасность при первом расколе (spec §7, DESIGN_SYSTEM.md экран 14): один экран, нельзя пропустить свайпом
// назад, «Понимаю» активна через 5 с. Тексты правил — дословно из прототипа (safetyRules).
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { SectionLabel, StepRow } from '../components/ui';
import { acknowledgeSafety } from '../lib/prefs';
import { pluralRu } from '../lib/text';
import type { RootStackParamList } from '../navigation/types';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Safety'>;

export const SAFETY_DELAY_S = 5;

const RULES = [
  { title: 'Очки или защита глаз', body: 'Осколки камня летят непредсказуемо и остаются острыми.' },
  { title: 'Отвернитесь и отойдите', body: 'Люди и животные — не ближе трёх метров от места удара.' },
  { title: 'Не бейте по руке', body: 'Положите камень на твёрдую опору, руку уберите.' },
] as const;

export function SafetyScreen({ navigation, route }: Props) {
  const [left, setLeft] = useState(SAFETY_DELAY_S);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const ready = left <= 0;
  const proceed = async () => {
    if (!ready) return;
    await acknowledgeSafety();
    navigation.navigate('Tabs', { screen: 'Camera', params: { parentCardId: route.params.parentCardId } }, { pop: true });
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 30, paddingBottom: insets.bottom + 26 }]}
    >
      <View style={styles.head}>
        <SectionLabel color={colors.gold} style={styles.label}>перед первым расколом</SectionLabel>
        <Text style={styles.h2}>Раскол — необратимый шаг</Text>
        <Text style={styles.sub}>Закрытая версия карточки исчезнет. Score может вырасти или упасть.</Text>
      </View>

      <View style={styles.rules}>
        {RULES.map((r, i) => <StepRow key={r.title} n={i + 1} tone="gold" title={r.title} body={r.body} />)}
      </View>

      <View style={styles.spacer} />

      <BigButton
        label={ready ? 'Понимаю' : `Понимаю · через ${left} ${pluralRu(left, 'секунду', 'секунды', 'секунд')}`}
        onPress={() => { void proceed(); }}
        disabled={!ready}
      />
      <BigButton label="Отмена" variant="ghost" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, paddingHorizontal: 22, gap: 22 },
  head: { gap: 8 },
  label: { letterSpacing: 1.8 },
  h2: { fontFamily: fonts.serif, fontSize: 26, lineHeight: 31, color: colors.text },
  sub: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: colors.textMuted },
  rules: { gap: 11 },
  spacer: { flex: 1 },
});
