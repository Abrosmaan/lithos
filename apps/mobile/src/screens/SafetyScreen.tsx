// Безопасность при первом расколе (spec §7): один экран, нельзя пропустить, «Понимаю» через 5 с.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { acknowledgeSafety } from '../lib/prefs';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Safety'>;

export const SAFETY_DELAY_S = 5;

const RULES = [
  { icon: '🥽', title: 'Наденьте очки', text: 'Осколки летят непредсказуемо. Любые защитные или хотя бы солнечные очки.' },
  { icon: '↩️', title: 'Отвернитесь в момент удара', text: 'Лицо — в сторону от камня. Рядом не должно быть людей и животных.' },
  { icon: '✋', title: 'Не бейте по руке', text: 'Камень — на твёрдой земле или другом камне, не в ладони. Держите его щипцами или прижмите ногой в обуви.' },
];

export function SafetyScreen({ navigation, route }: Props) {
  const [left, setLeft] = useState(SAFETY_DELAY_S);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const proceed = async () => {
    await acknowledgeSafety();
    navigation.navigate('Tabs', { screen: 'Camera', params: { parentCardId: route.params.parentCardId } }, { pop: true });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      <Text style={styles.h1}>Перед тем как расколоть</Text>
      <Text style={styles.muted}>Раскол необратим, а осколки острые. Три правила — и можно.</Text>
      <View style={styles.rules}>
        {RULES.map((r) => (
          <View key={r.title} style={styles.rule}>
            <Text style={styles.icon}>{r.icon}</Text>
            <View style={styles.ruleText}>
              <Text style={styles.ruleTitle}>{r.title}</Text>
              <Text style={styles.ruleBody}>{r.text}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={styles.spacer} />
      <BigButton label={left > 0 ? `Понимаю (${left})` : 'Понимаю'} onPress={() => { void proceed(); }} disabled={left > 0} />
      <BigButton label="Отмена" variant="secondary" onPress={() => navigation.goBack()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.md },
  h1: { color: colors.text, fontSize: 28, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 16, lineHeight: 22 },
  rules: { gap: spacing.md, marginTop: spacing.sm },
  rule: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  icon: { fontSize: 32 },
  ruleText: { flex: 1, gap: 2 },
  ruleTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  ruleBody: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  spacer: { flex: 1 },
});
