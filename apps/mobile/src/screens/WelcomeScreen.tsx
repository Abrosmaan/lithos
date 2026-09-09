// Приветствие (DESIGN_SYSTEM.md, экран 1): показывается один раз (флаг в prefs), тексты — дословно из прототипа.
// После «Найти первый камень» — камера с оверлеем первого запуска.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { StepRow } from '../components/ui';
import { markWelcomeSeen } from '../lib/prefs';
import type { RootStackParamList } from '../navigation/types';
import { colors, fonts, placeholderStripes, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

const STEPS = [
  { title: 'Снимите камень', body: 'Крупно, на нейтральном фоне. Одно фото — с монетой или пальцем для масштаба.' },
  { title: 'Получите карточку', body: 'Порода, редкость, три факта и короткая история происхождения.' },
  { title: 'Соберите место', body: 'Дневник показывает, какие породы здесь ожидаемы и что уже найдено.' },
] as const;

const PRIVACY_MORE =
  'Снимки лежат в закрытом хранилище проекта и доступны только вам и модели. Имя, координаты и снимки не публикуются ' +
  'и другим пользователям не показываются. Удалить все данные можно в профиле.';

export function WelcomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [more, setMore] = useState(false);

  const start = () => {
    void markWelcomeSeen();
    navigation.replace('Tabs', { screen: 'Camera' });
  };

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
        <View style={styles.dataHead}>
          <View style={styles.checkbox} />
          <Text style={type.bodyStrong}>Что мы делаем с фото</Text>
        </View>
        <Text style={styles.dataText}>
          Мы храним все снимки камней и учим на них модель определять породы точнее — без этого вердикт остаётся приблизительным. Снимки не привязаны к имени, не публикуются и не показываются другим пользователям.
        </Text>
        {more ? <Text style={styles.dataText}>{PRIVACY_MORE}</Text> : null}
        <Pressable onPress={() => setMore((v) => !v)} accessibilityRole="button" hitSlop={6}>
          <Text style={styles.link}>{more ? 'Свернуть' : 'Подробнее о данных'}</Text>
        </Pressable>
      </View>

      <View style={styles.spacer} />

      <View style={styles.footer}>
        <BigButton label="Найти первый камень" onPress={start} />
        <Text style={styles.consent}>Регистрация не нужна. Продолжая, вы соглашаетесь на хранение снимков для обучения модели.</Text>
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
  dataHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 15, height: 15, borderRadius: 3, borderWidth: 1.5, borderColor: colors.accentBright },
  dataText: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20, color: colors.textMuted },
  link: { fontFamily: fonts.sansSemi, fontSize: 13.5, lineHeight: 18, color: colors.accentBright },
  spacer: { flex: 1 },
  footer: { gap: 10 },
  consent: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: colors.textDim, textAlign: 'center' },
});
