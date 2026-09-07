// Экран Review (dev-plan T1.4): миниатюры, отметка масштаба, вес/царапина/мокрый, «Определить».
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { PhotoThumb } from '../components/PhotoThumb';
import { Segmented } from '../components/Segmented';
import { getDeviceId } from '../lib/auth';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { type GeoStatus, requestGeoFix } from '../lib/location';
import { MAX_PHOTOS, submitScan } from '../lib/scan';
import { useScanDraft } from '../lib/scan-draft';
import { createScanId } from '../lib/scan-id';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

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
  const { photos, tests, scanId: draftScanId, removePhoto, setScalePhoto, setTests, setScanId, reset } = useScanDraft();
  const [busy, setBusy] = useState(false);
  const [geoStatus, setGeoStatus] = useState<GeoStatus | null>(null);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    let alive = true;
    requestGeoFix().then((r) => { if (alive) setGeoStatus(r.status); });
    return () => { alive = false; };
  }, []);

  const scaleIndex = photos.findIndex((p) => p.isScale);

  const submit = async () => {
    if (busy || photos.length === 0) return;
    setBusy(true);
    try {
      const geo = await requestGeoFix();
      setGeoStatus(geo.status);
      if (!geo.fix) {
        const go = await confirmAsync('Нет геопозиции', MSG.noGeo + '. Продолжить?', 'Продолжить без гео');
        if (!go) return;
      }
      // Тот же scan_id при повторе после сбоя (идемпотентность); черновик сбрасывает его при изменениях.
      const scanId = draftScanId ?? (await createScanId(await getDeviceId()));
      setScanId(scanId);
      await submitScan({
        scanId,
        photos,
        tests: { ...tests, has_scale_photo: scaleIndex >= 0 },
        geo: geo.fix,
      });
      reset();
      navigation.replace('Result', { scanId });
    } catch (e) {
      logError('submit', e);
      Alert.alert('Не получилось', toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
      <Text style={styles.h1}>Фото ({photos.length} / {MAX_PHOTOS})</Text>
      <Text style={styles.muted}>Нажмите на фото, где есть монета или палец — оно задаст масштаб.</Text>
      <View style={styles.photos}>
        {photos.map((p, i) => (
          <PhotoThumb key={p.uri} uri={p.uri} size={104} isScale={p.isScale} onPress={() => setScalePhoto(p.isScale ? null : i)} onRemove={() => removePhoto(i)} />
        ))}
      </View>
      {scaleIndex < 0 && <Text style={styles.warn}>Фото с масштабом не отмечено — размер камня будет оценён примерно.</Text>}
      {photos.length < MAX_PHOTOS && (
        <BigButton label={photos.length === 0 ? 'Снять фото' : 'Добавить или переснять'} variant="secondary" onPress={() => navigation.navigate('Camera')} />
      )}

      <Text style={styles.h1}>Подсказки для определения</Text>
      <Text style={styles.muted}>Необязательно, но каждый ответ повышает точность и даёт бонус к редкости.</Text>
      <Segmented title="Вес в руке" options={WEIGHT_OPTIONS} value={tests.weight} onChange={(v) => setTests({ weight: v })} />
      <Segmented title="Чем царапается" options={SCRATCH_OPTIONS} value={tests.scratch} onChange={(v) => setTests({ scratch: v })} />
      <Segmented title="Камень" options={WET_OPTIONS} value={tests.wet} onChange={(v) => setTests({ wet: v })} />

      {geoStatus !== null && geoStatus !== 'granted' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{MSG.noGeo}</Text>
        </View>
      )}

      <BigButton label="Определить" onPress={() => { void submit(); }} disabled={photos.length === 0} loading={busy} style={styles.submit} />
      {busy && <Text style={styles.muted}>Загружаем фото…</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md },
  h1: { color: colors.text, fontSize: 20, fontWeight: '700', marginTop: spacing.sm },
  muted: { color: colors.textMuted, fontSize: 14 },
  warn: { color: '#e0c36a', fontSize: 14 },
  photos: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.sm, paddingRight: spacing.sm },
  banner: { backgroundColor: colors.warning, padding: spacing.md, borderRadius: 12 },
  bannerText: { color: '#fff', fontSize: 15 },
  submit: { marginTop: spacing.sm },
});
