// Экран «Проверка» (dev-plan T1.4, DESIGN_SYSTEM.md экран 4): шапка со стрелкой, миниатюры 94px (тап = масштаб),
// плитка «Добавить или переснять», три Segmented с mono-подписями, золотой баннер без гео, плашка лимита, «Определить».
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { PhotoThumb } from '../components/PhotoThumb';
import { Segmented } from '../components/Segmented';
import { Chevron, Note } from '../components/ui';
import { getDeviceId } from '../lib/auth';
import { logError, MSG, toUserMessage, UserError } from '../lib/errors';
import { type GeoStatus, requestGeoFix } from '../lib/location';
import { limitErrorCode, rejectText } from '../lib/result-text';
import { MAX_PHOTOS, submitScan } from '../lib/scan';
import { useScanDraft } from '../lib/scan-draft';
import { createScanId } from '../lib/scan-id';
import type { RootStackParamList } from '../navigation/types';
import { colors, density, fonts, radius } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Review'>;

const WEIGHT_OPTIONS = [
  { value: 'lighter', label: 'Легче' },
  { value: 'normal', label: 'Обычный' },
  { value: 'heavier', label: 'Тяжелее' },
] as const;
const SCRATCH_OPTIONS = [
  { value: 'nail', label: 'Ногтем' },
  { value: 'coin', label: 'Монетой' },
  { value: 'none', label: 'Не царапается' },
] as const;
const WET_OPTIONS = [
  { value: false, label: 'Сухой' },
  { value: true, label: 'Мокрый' },
] as const;

function confirmAsync(title: string, message: string, okLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Отмена', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, onPress: () => resolve(true) },
    ]);
  });
}

export function ReviewScreen({ navigation }: Props) {
  const { photos, tests, scanId: draftScanId, parentCardId, removePhoto, setScalePhoto, setTests, setScanId, reset } = useScanDraft();
  const isSplit = parentCardId !== null;
  const [busy, setBusy] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const [geoStatus, setGeoStatus] = useState<GeoStatus | null>(null);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (isSplit) return; // раскол: гео и тесты берутся от родительской карточки (воркер T2.3)
    let alive = true;
    requestGeoFix().then((r) => { if (alive) setGeoStatus(r.status); });
    return () => { alive = false; };
  }, [isSplit]);

  const scaleIndex = photos.findIndex((p) => p.isScale);
  const toCamera = () => navigation.navigate('Tabs', { screen: 'Camera' }, { pop: true });

  const submit = async () => {
    if (busy || photos.length === 0 || limitHit) return;
    setBusy(true);
    try {
      const geo = isSplit ? null : await requestGeoFix();
      if (geo) {
        setGeoStatus(geo.status);
        if (!geo.fix) {
          const go = await confirmAsync('Нет геопозиции', MSG.noGeo + '. Продолжить?', 'Продолжить без гео');
          if (!go) return;
        }
      }
      // Тот же scan_id при повторе после сбоя (идемпотентность); черновик сбрасывает его при изменениях.
      const scanId = draftScanId ?? (await createScanId(await getDeviceId()));
      setScanId(scanId);
      await submitScan({
        scanId,
        photos,
        tests: { ...tests, has_scale_photo: scaleIndex >= 0 },
        geo: geo?.fix ?? null,
        parentCardId,
      });
      reset();
      navigation.replace('Result', { scanId });
    } catch (e) {
      logError('submit', e);
      // Лимит сканов (T3.4): красная плашка и «Лимит исчерпан» вместо Alert; перегрузка — Alert с текстом прототипа.
      const code = e instanceof UserError ? limitErrorCode(e.cause instanceof Object && 'message' in e.cause ? String((e.cause as { message?: unknown }).message) : e.userMessage) : null;
      if (code === 'rate_limited' || e instanceof UserError && e.userMessage === rejectText('rate_limited').hint) setLimitHit(true);
      else Alert.alert('Не получилось', toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 30 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Назад" style={styles.back} hitSlop={8}>
          <Chevron direction="left" color={colors.text} size={11} />
        </Pressable>
        <Text style={styles.title}>Проверка</Text>
      </View>

      {isSplit && <Note tone="neutral">Раскол: фото свежего скола. Место и подсказки возьмём из исходной карточки.</Note>}

      <View style={styles.photosBlock}>
        <View style={styles.photos}>
          {photos.map((p, i) => (
            <PhotoThumb key={p.uri} uri={p.uri} size={94} tag={String(i + 1)} isScale={p.isScale} onPress={() => setScalePhoto(p.isScale ? null : i)} onRemove={() => removePhoto(i)} />
          ))}
          {photos.length < MAX_PHOTOS && (
            <Pressable onPress={toCamera} accessibilityRole="button" style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}>
              <View style={styles.plus}>
                <View style={styles.plusH} />
                <View style={styles.plusV} />
              </View>
              <Text style={styles.addText}>{photos.length === 0 ? 'Снять\nфото' : 'Добавить\nили переснять'}</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.caption}>Тап по фото отмечает его как снимок с масштабом — монета или палец рядом с камнем.</Text>
      </View>

      {!isSplit && (
        <View style={styles.segments}>
          <Segmented title="Вес в руке" options={WEIGHT_OPTIONS} value={tests.weight} onChange={(v) => setTests({ weight: v })} />
          <Segmented title="Царапина" options={SCRATCH_OPTIONS} value={tests.scratch} onChange={(v) => setTests({ scratch: v })} />
          <Segmented title="Состояние" options={WET_OPTIONS} value={tests.wet} onChange={(v) => setTests({ wet: v })} />
          <Text style={styles.captionDim}>Все три подсказки необязательны. Повторный тап снимает выбор.</Text>
        </View>
      )}

      {!isSplit && geoStatus !== null && geoStatus !== 'granted' && (
        <View style={styles.geoBanner}>
          <View style={styles.diamond} />
          <Text style={styles.geoText}>{MSG.noGeo}</Text>
        </View>
      )}

      {limitHit && <Note tone="danger">Лимит сканов на сегодня исчерпан — возвращайтесь завтра</Note>}

      <BigButton
        label={limitHit ? 'Лимит исчерпан' : 'Определить'}
        onPress={() => { void submit(); }}
        disabled={photos.length === 0 || limitHit}
        loading={busy}
      />
      {busy && <Text style={styles.captionDim}>Загружаем фото…</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, gap: density.gap },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  back: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.sansSemi, fontSize: 17, lineHeight: 22, color: colors.text },
  photosBlock: { gap: 10 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  addTile: { width: 94, height: 94, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(242,244,246,0.22)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  pressed: { opacity: 0.8 },
  plus: { width: 18, height: 18 },
  plusH: { position: 'absolute', top: 8, left: 0, width: 18, height: 2, backgroundColor: colors.textMuted },
  plusV: { position: 'absolute', left: 8, top: 0, width: 2, height: 18, backgroundColor: colors.textMuted },
  addText: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 14, color: colors.textMuted, textAlign: 'center' },
  caption: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: colors.textMuted },
  captionDim: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: colors.textDim },
  segments: { gap: 15 },
  geoBanner: { flexDirection: 'row', gap: 11, padding: 14, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: 'rgba(224,165,38,0.38)' },
  diamond: { width: 15, height: 15, marginTop: 2, borderRadius: 3, backgroundColor: colors.gold, transform: [{ rotate: '45deg' }] },
  geoText: { flex: 1, fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19.5, color: colors.goldText },
});
