// Пересогласие (T6.1 поток F, задача 2; docs/legal/consent-copy.md §2): показывается один раз тем, кто видел
// старую формулировку витрины («не публикуются и не показываются другим») — RootNavigator решает, входить ли
// сюда, через initialRoute (navigation/types.ts). Закрытие пишет текущую CONSENT_VERSION в prefs и уходит в Tabs.
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { CONSENT_UPDATE } from '../lib/consent';
import { markConsentVersion } from '../lib/prefs';
import type { RootScreenProps } from '../navigation/types';
import { colors, fonts, type } from '../theme';

type Props = RootScreenProps<'Consent'>;

export function ConsentScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const accept = () => {
    void markConsentVersion();
    navigation.replace('Tabs', { screen: 'Camera' });
  };

  const openPolicy = () => navigation.navigate('Policy', { doc: 'privacy' });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 26 }]}
    >
      <Text style={type.h1}>{CONSENT_UPDATE.title}</Text>

      <View style={styles.body}>
        {CONSENT_UPDATE.paragraphs.map((p, i) => (
          <Text key={i} style={styles.paragraph}>{p}</Text>
        ))}
      </View>

      <View style={styles.reassurance}>
        <Text style={styles.reassuranceText}>{CONSENT_UPDATE.reassurance}</Text>
      </View>

      <View style={styles.spacer} />

      <View style={styles.footer}>
        <BigButton label={CONSENT_UPDATE.confirm} onPress={accept} />
        <Text style={styles.link} onPress={openPolicy} accessibilityRole="link">
          {CONSENT_UPDATE.linkLabel}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, paddingHorizontal: 22, gap: 20 },
  body: { gap: 12 },
  paragraph: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 22, color: colors.textMuted },
  reassurance: { padding: 15, borderRadius: 14, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderStrong },
  reassuranceText: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20, color: colors.textSoft },
  spacer: { flex: 1, minHeight: 12 },
  footer: { gap: 14, alignItems: 'center' },
  link: { fontFamily: fonts.sansSemi, fontSize: 13.5, lineHeight: 18, color: colors.accentBright, textAlign: 'center' },
});
