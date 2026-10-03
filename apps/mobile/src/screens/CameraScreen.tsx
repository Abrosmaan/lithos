// Экран камеры (spec §12, DESIGN_SYSTEM.md экраны 2–3): живое превью, до 3 фото, S0 preflight сразу после съёмки.
// Пилюли-подсказки сверху, оверлей первого запуска, тост отказа, нижний блок с затемнением: подсказка про масштаб,
// миниатюры 60px, ряд «n / 3» · спуск 74px · «Далее», в режиме раскола — «Отменить раскол».
import { useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { FadeIn } from '../components/FadeIn';
import { FirstRunOverlay } from '../components/FirstRunOverlay';
import { PhotoThumb } from '../components/PhotoThumb';
import { Pill } from '../components/ui';
import { logError, MSG } from '../lib/errors';
import { prefetchGeo } from '../lib/location';
import { isFirstRunHintSeen, markFirstRunHintSeen } from '../lib/prefs';
import { deleteFileQuietly, preparePhoto } from '../lib/preflight';
import { MAX_PHOTOS } from '../lib/scan';
import { useScanDraft } from '../lib/scan-draft';
import type { TabScreenProps } from '../navigation/types';
import { colors, fonts, radius } from '../theme';

type Props = TabScreenProps<'Camera'>;

const CAPTURE_QUALITY = 0.9;
const TOAST_MS = 3_500;
/** Затемнение снизу (прототип: linear-gradient to top, rgba(11,15,20,.94) 24 % → прозрачность). */
const FADE_COLORS = ['transparent', 'rgba(11,15,20,0.94)'] as const;
const FADE_LOCATIONS = [0, 0.76] as const;

export function CameraScreen({ navigation, route }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const { photos, parentCardId, addPhoto, removePhoto, startSplit, reset } = useScanDraft();
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(true);
  const [firstRun, setFirstRun] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  useFocusEffect(useCallback(() => { setActive(true); return () => setActive(false); }, []));

  useEffect(() => {
    let alive = true;
    isFirstRunHintSeen().then((seen) => { if (alive) setFirstRun(!seen); });
    return () => { alive = false; };
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Раскол (T2.3): пришли с parentCardId → новый черновик со ссылкой на родителя; параметр гасим,
  // чтобы возврат на камеру после этого скана не начинал раскол заново.
  const splitParam = route.params?.parentCardId;
  useEffect(() => {
    if (!splitParam) return;
    startSplit(splitParam);
    navigation.setParams({ parentCardId: undefined });
  }, [splitParam, startSplit, navigation]);

  const full = photos.length >= MAX_PHOTOS;
  const split = parentCardId !== null;

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  const dismissFirstRun = () => { setFirstRun(false); void markFirstRunHintSeen(); };

  const cancelSplit = () => {
    if (photos.length === 0) { reset(); return; }
    Alert.alert('Отменить раскол?', 'Снятые фото будут удалены.', [
      { text: 'Продолжить съёмку', style: 'cancel' },
      { text: 'Отменить раскол', style: 'destructive', onPress: reset },
    ]);
  };

  const shoot = async () => {
    if (!cameraRef.current || busy || full) return;
    setBusy(true);
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: CAPTURE_QUALITY });
      if (photos.length === 0) prefetchGeo(); // гео — с первого снимка, не при открытии камеры
      let res;
      try {
        res = await preparePhoto(pic);
      } finally {
        deleteFileQuietly(pic.uri); // полноразмерный кадр больше не нужен — есть копия 1024 px
      }
      if (!res.ok) {
        showToast(res.reason === 'dark' ? MSG.dark : MSG.blurry);
        return;
      }
      addPhoto(res.photo);
      if (photos.length + 1 >= MAX_PHOTOS) navigation.navigate('Review');
    } catch (e) {
      logError('capture', e);
      showToast(MSG.captureFailed);
    } finally {
      setBusy(false);
    }
  };

  if (!permission) return <View style={styles.permScreen} />;

  if (!permission.granted) {
    return (
      <View style={[styles.permScreen, styles.permCenter]}>
        <View style={styles.camIcon}>
          <View style={styles.camLens} />
          <View style={styles.camStrike} />
        </View>
        <Text style={styles.permTitle}>Lithos нужна камера,{'\n'}чтобы определить камень</Text>
        <Text style={styles.permText}>Геопозицию спросим позже — только при первом снимке.</Text>
        <BigButton label="Разрешить камеру" onPress={() => { void requestPermission(); }} style={styles.permButton} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {active && <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />}

      <View style={[styles.top, { paddingTop: insets.top + 14 }]} pointerEvents="none">
        <Pill>{split ? 'Раскол: снимите свежий скол' : 'Наведите на камень'}</Pill>
        {split && <Pill tone="danger">гео и мини-тесты берём из исходной карточки</Pill>}
      </View>

      <View style={[styles.bottomWrap, { paddingBottom: insets.bottom + 16 }]}>
        {toast && (
          <FadeIn duration={220} rise={8} replayKey={toast} style={styles.toast}>
            <View style={styles.toastDot} />
            <Text style={styles.toastText}>{toast}</Text>
          </FadeIn>
        )}

        <LinearGradient colors={FADE_COLORS} locations={FADE_LOCATIONS} style={styles.fade} pointerEvents="none" />

        <Text style={styles.scaleHint}>Одно фото — с монетой или пальцем для масштаба</Text>

        {photos.length > 0 && (
          <View style={styles.strip}>
            {photos.map((p, i) => (
              <PhotoThumb key={p.uri} uri={p.uri} size={60} tag={String(i + 1)} isScale={p.isScale} onRemove={() => removePhoto(i)} />
            ))}
          </View>
        )}

        <View style={styles.controls}>
          <Text style={styles.counter}>{photos.length} / {MAX_PHOTOS}</Text>
          <Pressable
            onPress={() => { void shoot(); }}
            disabled={busy || full}
            accessibilityRole="button"
            accessibilityLabel="Сделать фото"
            style={({ pressed }) => [styles.shutter, (busy || full) && styles.shutterOff, pressed && styles.shutterPressed]}
          >
            {busy ? <ActivityIndicator color={colors.bg} /> : <View style={styles.shutterInner} />}
          </Pressable>
          <View style={styles.side}>
            <Pressable
              onPress={() => navigation.navigate('Review')}
              disabled={busy || photos.length === 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || photos.length === 0 }}
              style={({ pressed }) => [styles.next, photos.length === 0 && styles.nextOff, pressed && photos.length > 0 && styles.pressed]}
            >
              <Text style={[styles.nextText, photos.length === 0 && styles.nextTextOff]}>Далее</Text>
            </Pressable>
          </View>
        </View>

        {split && <BigButton label="Отменить раскол" variant="ghost" onPress={cancelSplit} />}
      </View>

      {firstRun && <FirstRunOverlay onDismiss={dismissFirstRun} />}
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  // Нет разрешения
  permScreen: { flex: 1, backgroundColor: colors.bg },
  permCenter: { alignItems: 'center', justifyContent: 'center', paddingVertical: 34, paddingHorizontal: 28, gap: 18 },
  camIcon: { width: 98, height: 72, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(242,244,246,0.28)', alignItems: 'center', justifyContent: 'center' },
  camLens: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: 'rgba(242,244,246,0.28)' },
  camStrike: { position: 'absolute', width: 118, height: 1.5, backgroundColor: colors.danger, transform: [{ rotate: '-30deg' }] },
  permTitle: { fontFamily: fonts.serif, fontSize: 23, lineHeight: 30, color: colors.text, textAlign: 'center' },
  permText: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: colors.textMuted, textAlign: 'center' },
  permButton: { alignSelf: 'stretch', marginTop: 6 },
  // Камера
  top: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', gap: 9, paddingHorizontal: 16 },
  bottomWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 14 },
  fade: { ...StyleSheet.absoluteFill, top: -40 },
  toast: {
    flexDirection: 'row', gap: 11, alignItems: 'flex-start', padding: 13, paddingHorizontal: 15, borderRadius: radius.md,
    backgroundColor: colors.dangerToastBg, borderWidth: 1, borderColor: 'rgba(176,58,46,0.5)', marginBottom: -2,
  },
  toastDot: { width: 17, height: 17, borderRadius: 8.5, backgroundColor: colors.danger, marginTop: 2 },
  toastText: { flex: 1, fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19.5, color: '#f7d9d4' },
  scaleHint: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: colors.textMuted, textAlign: 'center' },
  strip: { flexDirection: 'row', gap: 9, justifyContent: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  counter: { width: 86, fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 14, color: colors.textMuted },
  side: { width: 86, alignItems: 'flex-end' },
  shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 3, borderColor: 'rgba(242,244,246,0.85)', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.text },
  shutterOff: { opacity: 0.5 },
  shutterPressed: { transform: [{ scale: 0.94 }] },
  next: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: colors.accent },
  nextOff: { backgroundColor: colors.surfaceDim },
  nextText: { fontFamily: fonts.sansSemi, fontSize: 15, lineHeight: 18, color: colors.accentText },
  nextTextOff: { color: colors.textFaint },
  pressed: { opacity: 0.85 },
});
