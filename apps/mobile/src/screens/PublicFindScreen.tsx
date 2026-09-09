// Чужая находка (T6.1-E2, поток E): только чтение — фото, порода, тир, score, лор, автор, ячейка и дата.
// Никаких действий владельца (раскол/публикация/переименование/удаление) — это не карточка смотрящего.
// Данные приходят параметром экрана: карта и дневник места уже держат нужную строку lithos.public_finds
// (из listPublicFinds), а отдельного запроса «получить находку по id» lib/publish.ts не предоставляет —
// заводить его ради одного read-only экрана незачем (T6.1-D сознательно держит поверхность узкой).
// Точных координат здесь нет по построению — только центр ячейки geohash-6 (~1,2 км), и текст честно
// это объясняет, а не выглядит как точная точка.
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { Section } from '../components/Section';
import { KeyValue, PhotoPlaceholder, TierLine } from '../components/ui';
import { displayName, formatDateRu, rockClassRu, tierLabel } from '../lib/card-facts';
// REPORT_DIALOG — consent-copy.md §7, готовые тексты жалобы (поток F подготовил их прямо для этого экрана,
// см. комментарий в lib/consent.ts). Файл в границах потока F — только импорт, не редактируем.
import { REPORT_DIALOG } from '../lib/consent';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { fetchPublicPhotoUrl, reportCard, REPORT_REASON_MAX } from '../lib/publish';
import { cellCoordsText } from '../lib/screen-text';
import type { RootScreenProps } from '../navigation/types';
import { colors, density, fonts, placeholderStripes, radius, spacing, tierColor, type } from '../theme';

type Props = RootScreenProps<'PublicFind'>;

const PHOTO_H = 224;

export function PublicFindScreen({ route }: Props) {
  const { find } = route.params;
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoChecked, setPhotoChecked] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let alive = true;
    void fetchPublicPhotoUrl(find.id).then((url) => {
      if (!alive) return;
      setPhotoUrl(url);
      setPhotoChecked(true);
    });
    return () => { alive = false; };
  }, [find.id]);

  const closeReport = () => {
    if (submitting) return;
    setReportOpen(false);
    setReason('');
  };

  const submitReport = async () => {
    setSubmitting(true);
    try {
      const result = await reportCard(find.id, reason);
      setSubmitting(false);
      setReportOpen(false);
      setReason('');
      Alert.alert('Готово', result === 'already_reported' ? REPORT_DIALOG.alreadyReported : REPORT_DIALOG.sent);
    } catch (e) {
      setSubmitting(false);
      logError('publicFind.report', e);
      Alert.alert('Не получилось', toUserMessage(e, MSG.submitFailed));
    }
  };

  const name = displayName(find);
  const author = find.author_name ?? 'Без имени';
  const accent = tierColor(find.tier);
  const place = find.cell_id ? cellCoordsText(find.center) : 'Без геопозиции';
  const date = formatDateRu(find.published_at ?? find.created_at) ?? '—';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
      <View style={styles.photoWrap}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.photo} contentFit="cover" transition={150} accessibilityLabel="Фото находки" />
        ) : (
          <PhotoPlaceholder label={photoChecked ? 'фото недоступно' : undefined} height={PHOTO_H} style={styles.photo} />
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.nameBlock}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.author}>Автор: {author}</Text>
        </View>

        <View style={[styles.tierBlock, { borderColor: accent }]}>
          <TierLine tierName={tierLabel(find.tier)} tier={find.tier} scoreText={find.score === null ? '—' : String(find.score)} size="md" />
        </View>

        <Section title="Порода">
          <KeyValue k="Порода" v={rockClassRu(find.rock_class)} />
        </Section>

        {find.lore ? (
          <Section title="Лор">
            <Text style={type.lore}>{find.lore}</Text>
          </Section>
        ) : null}

        <Section title="Место и дата">
          <KeyValue k="Место" v={place} />
          <KeyValue k="Дата" v={date} />
        </Section>

        <Text style={styles.honesty}>
          Место — центр ячейки геопозиции (~1,2 км), а не точная точка находки: её автор не показывает никому.
        </Text>

        <BigButton label="Пожаловаться" variant="secondary" onPress={() => setReportOpen(true)} />
      </View>

      <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={closeReport}>
        <Pressable style={styles.sheetBackdrop} onPress={closeReport} accessibilityRole="button" accessibilityLabel="Закрыть" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetGrip} />
          <Text style={styles.sheetTitle}>{REPORT_DIALOG.title}</Text>
          <Text style={styles.sheetBody}>{REPORT_DIALOG.body}</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={REPORT_DIALOG.placeholder}
            placeholderTextColor={colors.textDim}
            maxLength={REPORT_REASON_MAX}
            multiline
            editable={!submitting}
            style={styles.input}
          />
          <View style={styles.sheetButtons}>
            <BigButton label={REPORT_DIALOG.cancel} variant="secondary" onPress={closeReport} disabled={submitting} style={styles.sheetBtn} />
            {submitting ? (
              <View style={[styles.sheetBtn, styles.sheetBtnLoading]}><ActivityIndicator color={colors.accentText} /></View>
            ) : (
              <BigButton label={REPORT_DIALOG.confirm} onPress={() => { void submitReport(); }} style={styles.sheetBtn} />
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { gap: density.gap },
  photoWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  photo: { width: '100%', height: PHOTO_H, borderRadius: 18, backgroundColor: placeholderStripes.a, overflow: 'hidden' },
  body: { paddingHorizontal: spacing.md, gap: density.gap },
  nameBlock: { gap: 4 },
  name: { ...type.h2, fontSize: 25, lineHeight: 30 },
  author: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 18, color: colors.textMuted },
  tierBlock: { gap: 12, padding: 15, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1 },
  honesty: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: colors.textDim },
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,15,20,0.6)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%', backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderTopWidth: 1, borderColor: colors.divider, paddingTop: 10, paddingHorizontal: 16, gap: 12 },
  sheetGrip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 22, color: colors.text },
  sheetBody: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19, color: colors.textMuted },
  input: { minHeight: 80, paddingVertical: 12, paddingHorizontal: 13, borderRadius: 12, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.divider, color: colors.text, fontFamily: fonts.sans, fontSize: 14, textAlignVertical: 'top' },
  sheetButtons: { flexDirection: 'row', gap: 10, paddingBottom: 4 },
  sheetBtn: { flex: 1 },
  sheetBtnLoading: { minHeight: 50, alignItems: 'center', justifyContent: 'center' },
});
