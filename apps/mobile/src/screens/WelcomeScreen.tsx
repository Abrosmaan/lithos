// Приветствие (DESIGN_SYSTEM.md, экран 1): показывается один раз (флаг в prefs), тексты — дословно из прототипа.
// После «Найти первый камень» — камера с оверлеем первого запуска.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { StepRow } from '../components/ui';
import { ONBOARDING_CONSENT, ONBOARDING_PHOTO, TRAINING_CONSENT_CHECKBOX } from '../lib/consent';
import { markConsentVersion, markWelcomeSeen } from '../lib/prefs';
import { commitTrainingChoice } from '../lib/profile';
import type { RootStackParamList } from '../navigation/types';
import { colors, fonts, placeholderStripes, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

const STEPS = [
  { title: 'Снимите камень', body: 'Крупно, на нейтральном фоне. Одно фото — с монетой или пальцем для масштаба.' },
  { title: 'Получите карточку', body: 'Порода, редкость, три факта и короткая история происхождения.' },
  { title: 'Соберите место', body: 'Дневник показывает, какие породы здесь ожидаемы и что уже найдено.' },
] as const;

export function WelcomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [more, setMore] = useState(false);
  // Согласие на обучение — отдельная галочка, отдельная от принятия соглашения/политики (T6.1-F, замечание 1).
  // По умолчанию не отмечена: отказ не блокирует онбординг, это единственный необязательный пункт на экране.
  const [trainingConsent, setTrainingConsent] = useState(false);

  const start = () => {
    void markWelcomeSeen();
    // Онбординг уже показал актуальную формулировку (ONBOARDING_PHOTO/ONBOARDING_CONSENT) — новый пользователь
    // не должен сразу же увидеть ConsentScreen с «мы меняем правила» после того, как только что их принял.
    void markConsentVersion();
    // Сессия на этот момент может быть ещё не создана — commitTrainingChoice сохраняет выбор локально сразу
    // и пробует отправить на сервер; при неудаче досылает его при первой возможности (lib/profile.ts).
    void commitTrainingChoice(trainingConsent);
    navigation.replace('Tabs', { screen: 'Camera' });
  };

  const openPolicy = (doc: 'privacy' | 'terms') => navigation.navigate('Policy', { doc });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 26 }]}>
      <View style={styles.intro}>
        <Text style={type.brand}>LITHOS</Text>
        <View style={styles.hero}>
          <View style={styles.stone} />
          <Text style={styles.heroLabel}>снимок камня на галечнике</Text>
        </View>
        <Text style={styles.slogan}>Каждый камень под ногами — карточка с историей в миллионы лет</Text>
        <Text style={styles.lead}>
          Сфотографируйте камень на пляже или у тропы. Через несколько секунд получите породу, редкость и короткую историю о том, как он здесь оказался. Находки собираются в коллекцию и привязываются к месту.
        </Text>
      </View>

      <View style={styles.steps}>
        {STEPS.map((s, i) => <StepRow key={s.title} n={i + 1} title={s.title} body={s.body} />)}
      </View>

      <View style={styles.dataCard}>
        <Text style={type.bodyStrong}>{ONBOARDING_PHOTO.title}</Text>
        <Text style={styles.dataText}>{ONBOARDING_PHOTO.body}</Text>
        {more ? <Text style={styles.dataText}>{ONBOARDING_PHOTO.more}</Text> : null}
        <Pressable onPress={() => setMore((v) => !v)} accessibilityRole="button" hitSlop={6}>
          <Text style={styles.link}>{more ? ONBOARDING_PHOTO.lessLabel : ONBOARDING_PHOTO.moreLabel}</Text>
        </Pressable>

        <Pressable
          style={styles.trainingRow}
          onPress={() => setTrainingConsent((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: trainingConsent }}
          accessibilityLabel={TRAINING_CONSENT_CHECKBOX.label}
          hitSlop={4}
        >
          <View style={[styles.checkbox, trainingConsent && styles.checkboxChecked]}>
            {trainingConsent ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <View style={styles.trainingTextWrap}>
            <Text style={styles.dataText}>{TRAINING_CONSENT_CHECKBOX.label}</Text>
            <Text style={styles.trainingNote}>{TRAINING_CONSENT_CHECKBOX.note}</Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.spacer} />

      <View style={styles.footer}>
        <BigButton label="Найти первый камень" onPress={start} />
        <Text style={styles.consent}>
          {ONBOARDING_CONSENT.before}
          <Text style={styles.consentLink} onPress={() => openPolicy('terms')} accessibilityRole="link">
            {ONBOARDING_CONSENT.termsLabel}
          </Text>
          {ONBOARDING_CONSENT.between}
          <Text style={styles.consentLink} onPress={() => openPolicy('privacy')} accessibilityRole="link">
            {ONBOARDING_CONSENT.privacyLabel}
          </Text>
          {ONBOARDING_CONSENT.after}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, paddingHorizontal: 22, gap: 26 },
  intro: { gap: 16 },
  hero: { height: 158, borderRadius: 20, overflow: 'hidden', backgroundColor: placeholderStripes.a, alignItems: 'center', justifyContent: 'center' },
  stone: {
    width: 88, height: 74, backgroundColor: '#2f3a48', borderWidth: 1, borderColor: colors.divider,
    borderTopLeftRadius: 40, borderTopRightRadius: 48, borderBottomRightRadius: 34, borderBottomLeftRadius: 44,
  },
  heroLabel: { position: 'absolute', left: 12, bottom: 10, fontFamily: fonts.monoRegular, fontSize: 9, lineHeight: 10, letterSpacing: 1.1, color: colors.textDim },
  slogan: { fontFamily: fonts.serif, fontSize: 29, lineHeight: 34, color: colors.text },
  lead: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 22, color: colors.textMuted },
  steps: { gap: 11 },
  dataCard: { padding: 16, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 9 },
  dataText: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20, color: colors.textMuted },
  link: { fontFamily: fonts.sansSemi, fontSize: 13.5, lineHeight: 18, color: colors.accentBright },
  trainingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 4 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.accentBright, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.accentBright },
  checkboxMark: { fontSize: 12, lineHeight: 13, color: colors.bg, fontFamily: fonts.sansSemi },
  trainingTextWrap: { flex: 1, gap: 3 },
  trainingNote: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, color: colors.textDim },
  spacer: { flex: 1 },
  footer: { gap: 10 },
  consent: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: colors.textDim, textAlign: 'center' },
  consentLink: { fontFamily: fonts.sansSemi, color: colors.accentBright },
});
