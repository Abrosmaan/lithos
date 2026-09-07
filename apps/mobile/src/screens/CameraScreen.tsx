// Экран 1 (spec §12): живое превью, до 3 фото, S0 preflight сразу после съёмки.
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { PhotoThumb } from '../components/PhotoThumb';
import { logError, MSG } from '../lib/errors';
import { prefetchGeo } from '../lib/location';
import { deleteFileQuietly, preparePhoto } from '../lib/preflight';
import { MAX_PHOTOS } from '../lib/scan';
import { useScanDraft } from '../lib/scan-draft';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Camera'>;

const CAPTURE_QUALITY = 0.9;

export function CameraScreen({ navigation, route }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const { photos, parentCardId, addPhoto, removePhoto, startSplit, reset } = useScanDraft();
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(true);
  const insets = useSafeAreaInsets();

  useFocusEffect(useCallback(() => { setActive(true); return () => setActive(false); }, []));

  // Раскол (T2.3): пришли с parentCardId → новый черновик со ссылкой на родителя; параметр гасим,
  // чтобы возврат на камеру после этого скана не начинал раскол заново.
  const splitParam = route.params?.parentCardId;
  useEffect(() => {
    if (!splitParam) return;
    startSplit(splitParam);
    navigation.setParams({ parentCardId: undefined });
  }, [splitParam, startSplit, navigation]);

  const full = photos.length >= MAX_PHOTOS;

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
        Alert.alert(res.reason === 'dark' ? 'Слишком темно' : 'Фото размыто', res.reason === 'dark' ? MSG.dark : MSG.blurry);
        return;
      }
      addPhoto(res.photo);
      if (photos.length + 1 >= MAX_PHOTOS) navigation.navigate('Review');
    } catch (e) {
      logError('capture', e);
      Alert.alert('Ошибка', MSG.captureFailed);
    } finally {
      setBusy(false);
    }
  };

  if (!permission) return <View style={styles.center} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Lithos нужна камера, чтобы определить камень.</Text>
        <BigButton label="Разрешить камеру" onPress={() => { void requestPermission(); }} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {active && <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />}

      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.hint}>
          <Text style={styles.hintText}>{parentCardId ? 'Раскол: снимите свежий скол крупно' : 'Одно фото — с монетой или пальцем для масштаба'}</Text>
        </View>
        {parentCardId ? (
          <Pressable onPress={cancelSplit} accessibilityRole="button" style={styles.counter}>
            <Text style={styles.counterText}>Отменить раскол</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => navigation.navigate('Collection')} accessibilityRole="button" style={styles.counter}>
            <Text style={styles.counterText}>Коллекция</Text>
          </Pressable>
        )}
        <View style={styles.counter}>
          <Text style={styles.counterText}>{photos.length} / {MAX_PHOTOS}</Text>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.strip}>
          {photos.map((p, i) => (
            <PhotoThumb key={p.uri} uri={p.uri} size={56} isScale={p.isScale} onRemove={() => removePhoto(i)} />
          ))}
        </View>

        <View style={styles.controls}>
          <View style={styles.side} />
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
            {photos.length > 0 && (
              <Pressable onPress={() => navigation.navigate('Review')} disabled={busy} accessibilityRole="button" style={[styles.next, busy && styles.shutterOff]}>
                <Text style={styles.nextText}>Далее</Text>
              </Pressable>
            )}
          </View>
        </View>
        {full && <Text style={styles.fullText}>Максимум {MAX_PHOTOS} фото — нажмите «Далее»</Text>}
      </View>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.bg, gap: spacing.md },
  permText: { color: colors.text, fontSize: 17, textAlign: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  hint: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  hintText: { color: '#fff', fontSize: 15, textAlign: 'center' },
  counter: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.lg },
  counterText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: spacing.md, gap: spacing.md },
  strip: { flexDirection: 'row', gap: spacing.md, minHeight: 56, paddingLeft: spacing.sm },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { width: 96, alignItems: 'center' },
  shutter: { width: 84, height: 84, borderRadius: radius.full, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)' },
  shutterInner: { width: 64, height: 64, borderRadius: radius.full, backgroundColor: '#fff', borderWidth: 2, borderColor: colors.bg },
  shutterOff: { opacity: 0.5 },
  shutterPressed: { transform: [{ scale: 0.94 }] },
  next: { backgroundColor: colors.accent, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.md },
  nextText: { color: colors.accentText, fontSize: 16, fontWeight: '600' },
  fullText: { color: '#fff', textAlign: 'center', fontSize: 13, opacity: 0.8 },
});
