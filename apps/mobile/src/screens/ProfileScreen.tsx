// Профиль (spec §8, §12; T3.3; DESIGN_SYSTEM.md экран 13): имя (lithos.users.display_name), статистика,
// распределение по тирам, редчайшая/самая далёкая находка, мои публикации (T6.1, витрина = публикация,
// cards.published — не локальный AsyncStorage), блоки «Аккаунт» и «Настройки» (T5.3, T6.1 поток F/E3).
import { Camera } from 'expo-camera';
import Constants from 'expo-constants';
import { getForegroundPermissionsAsync } from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { CardTile } from '../components/CardTile';
import { SettingsList } from '../components/SettingsList';
import { Note, SectionLabel } from '../components/ui';
import type { CardRow } from '../lib/card-types';
import { SHOWCASE_PROFILE_FOOTNOTE } from '../lib/consent';
import { logError, MSG, toUserMessage } from '../lib/errors';
import { farthestFind, formatDistance } from '../lib/geo-math';
import { loadCards } from '../lib/offline-cache';
import { fetchPrimaryPhotoUrls } from '../lib/photo-urls';
import { countScans, countScansToday, deleteServerData, DISPLAY_NAME_MAX, fetchProfile, type Profile, setTrainingOptIn, updateDisplayName, wipeLocalData } from '../lib/profile';
import { summarizeBulkUnpublish, UNPUBLISH_ALL_DIALOG } from '../lib/publications';
import { setPublished } from '../lib/publish';
import {
  APPLE_SIGNIN_SOON,
  appVersionText,
  PRIVACY_TEXT,
  PUBLICATIONS_EMPTY_TEXT,
  PUBLICATIONS_TEXT,
  publicationsValueText,
  scanLimitForAccount,
  SERVER_WIPE_DIALOG,
  SERVER_WIPE_DONE,
  SERVER_WIPE_FAILED,
  type SettingKey,
  settingsRows,
  toPermissionState,
  TRAINING_OPT_OUT_DIALOG,
  WIPE_DIALOG,
} from '../lib/settings';
import { rarestCard, tierDistribution } from '../lib/stats';
import type { TabScreenProps } from '../navigation/types';
import { colors, fonts, radius, tierColor } from '../theme';

type Props = TabScreenProps<'Profile'>;

export const DEFAULT_NAME = 'Собиратель камней';

const APP_VERSION = appVersionText(Constants.expoConfig?.version, Constants.expoConfig?.ios?.buildNumber ?? String(Constants.expoConfig?.android?.versionCode ?? ''));

export function ProfileScreen({ navigation }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [scans, setScans] = useState<number | null>(null);
  const [scansToday, setScansToday] = useState<number | null>(null);
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [camPerm, setCamPerm] = useState<string>('unknown');
  const [locPerm, setLocPerm] = useState<string>('unknown');
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showPublicationsInfo, setShowPublicationsInfo] = useState(false);
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [serverWiping, setServerWiping] = useState(false);
  const seq = useRef(0);
  const insets = useSafeAreaInsets(); // вкладка без хедера: верх контента ушёл бы под Dynamic Island

  const load = useCallback(async (isFocused: () => boolean = () => true) => {
    const my = ++seq.current;
    const isAlive = () => isFocused() && my === seq.current;
    try {
      const c = await loadCards();
      if (!isAlive()) return;
      setCards(c.data);
      setOffline(c.offline);
      setError(null);
      // Имя, счётчики, разрешения — только из сети/системы; офлайн остаются прошлые значения / «—».
      const [p, n, today, cam, loc] = await Promise.all([
        fetchProfile().catch((e) => { logError('profile.user', e); return null; }),
        countScans().catch((e) => { logError('profile.scans', e); return null; }),
        countScansToday().catch((e) => { logError('profile.scansToday', e); return null; }),
        Camera.getCameraPermissionsAsync().catch(() => null),
        getForegroundPermissionsAsync().catch(() => null),
      ]);
      if (!isAlive()) return;
      if (p) setProfile(p);
      if (n !== null) setScans(n);
      if (today !== null) setScansToday(today);
      if (cam) setCamPerm(cam.status);
      if (loc) setLocPerm(loc.status);
      // Фото — только для плиток на экране: мои публикации, редчайшая, самая далёкая.
      const shown = c.data.filter((x) => !x.hidden);
      const wanted = new Set<string>([...shown.filter((x) => x.published).map((x) => x.id), rarestCard(shown)?.id ?? '', farthestFind(shown)?.card.id ?? '']);
      const photos = await fetchPrimaryPhotoUrls(shown.filter((x) => wanted.has(x.id)).map((x) => x.scan_id));
      if (isAlive()) setUrls(photos);
    } catch (e) {
      if (!isAlive()) return;
      logError('profile', e);
      setError(toUserMessage(e, MSG.loadFailed));
    } finally {
      if (isAlive()) setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    void load(() => alive);
    return () => { alive = false; };
  }, [load]));

  const saveName = async () => {
    setSaving(true);
    try {
      const value = await updateDisplayName(draft);
      setProfile((p) => (p ? { ...p, displayName: value } : p));
      if (!profile) fetchProfile().then(setProfile).catch((e) => logError('profile.user', e));
      setEditing(false);
    } catch (e) {
      logError('profile.rename', e);
      Alert.alert('Не получилось', toUserMessage(e, MSG.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  const visible = useMemo(() => (cards ?? []).filter((c) => !c.hidden), [cards]);
  const buckets = useMemo(() => tierDistribution(visible), [visible]);
  const rarest = useMemo(() => rarestCard(visible), [visible]);
  const farthest = useMemo(() => farthestFind(visible), [visible]);
  // Мои публикации: витрина стала серверной (T6.1 §2.2) — источник правды это cards.published, а не
  // локальный AsyncStorage-список (lib/showcase.ts), который CardScreen больше не пополняет.
  const publications = useMemo(() => visible.filter((c) => c.published), [visible]);
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const openCard = (cardId: string) => navigation.navigate('Card', { cardId });

  const scanLimit = scanLimitForAccount(profile?.createdAt ?? null);
  const settings = useMemo(
    () => settingsRows({
      scansToday,
      scanLimit,
      camera: toPermissionState(camPerm),
      location: toPermissionState(locPerm),
      version: APP_VERSION,
      publishedCount: cards ? publications.length : null,
      trainingOptIn: profile?.trainingOptIn ?? null,
    }),
    [scansToday, scanLimit, camPerm, locPerm, cards, publications.length, profile?.trainingOptIn],
  );

  const onSettingPress = (key: SettingKey) => {
    if (serverWiping) return;
    if (key === 'camera' || key === 'location') { void Linking.openSettings(); return; }
    if (key === 'privacy') { setShowPrivacy((v) => !v); return; }
    if (key === 'publications') { setShowPublicationsInfo((v) => !v); return; }
    if (key === 'about') { Alert.alert('Lithos', `${APP_VERSION}\n\nМобильная игра-коллекционирование камней.`); return; }
    if (key === 'training') { onTrainingPress(); return; }
    if (key === 'privacyPolicy') { navigation.navigate('Policy', { doc: 'privacy' }); return; }
    if (key === 'termsOfUse') { navigation.navigate('Policy', { doc: 'terms' }); return; }
    if (key === 'serverWipe') {
      Alert.alert(SERVER_WIPE_DIALOG.title, SERVER_WIPE_DIALOG.body, [
        { text: SERVER_WIPE_DIALOG.cancel, style: 'cancel' },
        { text: SERVER_WIPE_DIALOG.confirm, style: 'destructive', onPress: () => { void doServerWipe(); } },
      ]);
      return;
    }
    if (key === 'wipe') {
      Alert.alert(WIPE_DIALOG.title, WIPE_DIALOG.body, [
        { text: WIPE_DIALOG.cancel, style: 'cancel' },
        { text: WIPE_DIALOG.confirm, style: 'destructive', onPress: () => { void doWipe(); } },
      ]);
      return;
    }
    Alert.alert('Скоро', 'Эта настройка появится в следующей версии.');
  };

  const doWipe = async () => {
    try {
      await wipeLocalData();
      // Сброс до корня стека (не просто .navigate('Welcome')): после очистки AsyncStorage возврат
      // аппаратной кнопкой «назад» не должен приводить на Profile с уже стёртыми локальными данными.
      // getParent() из вкладки — навигация корневого Stack.Navigator, где и объявлен экран Welcome.
      navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Welcome' }] });
    } catch (e) {
      logError('profile.wipe', e);
      Alert.alert('Не получилось', toUserMessage(e, MSG.saveFailed));
    }
  };

  // Удаление данных на сервере (consent-copy.md §6c) — необратимо, поэтому после успеха экран не должен
  // делать вид, что коллекция на месте: сбрасываем стек на Welcome, как doWipe() выше. serverWiping блокирует
  // повторные нажатия по настройкам, пока запрос летит (RPC + удаление файлов в Storage — не мгновенно).
  const doServerWipe = async () => {
    setServerWiping(true);
    try {
      await deleteServerData();
      Alert.alert('Готово', SERVER_WIPE_DONE, [
        { text: 'ОК', onPress: () => navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Welcome' }] }) },
      ]);
    } catch (e) {
      logError('profile.serverWipe', e);
      Alert.alert('Не получилось', SERVER_WIPE_FAILED);
      setServerWiping(false);
    }
  };

  // Обучение модели (consent-copy.md §6b): включение — сразу, отключение — только после подтверждения
  // (TRAINING_OPT_OUT_DIALOG). Оптимистичное переключение с откатом при ошибке сервера, как doPublish в CardScreen.
  const setTraining = async (value: boolean) => {
    if (!profile || trainingBusy) return;
    const prev = profile;
    setTrainingBusy(true);
    setProfile({ ...profile, trainingOptIn: value });
    try {
      await setTrainingOptIn(value);
    } catch (e) {
      logError('profile.trainingOptIn', e);
      setProfile(prev);
      Alert.alert('Не получилось', toUserMessage(e, MSG.saveFailed));
    } finally {
      setTrainingBusy(false);
    }
  };

  const onTrainingPress = () => {
    if (!profile || trainingBusy) return;
    if (profile.trainingOptIn) {
      Alert.alert(TRAINING_OPT_OUT_DIALOG.title, TRAINING_OPT_OUT_DIALOG.body, [
        { text: TRAINING_OPT_OUT_DIALOG.cancel, style: 'cancel' },
        { text: TRAINING_OPT_OUT_DIALOG.confirm, style: 'destructive', onPress: () => { void setTraining(false); } },
      ]);
    } else {
      void setTraining(true);
    }
  };

  // «Убрать все публикации» одним действием (T6.0 §2.3): Promise.allSettled — частичный сетевой отказ на
  // одной находке не должен молчать об остальных. summarizeBulkUnpublish формирует честный текст в обоих
  // случаях (см. lib/publications.ts).
  const unpublishAll = async () => {
    const targets = publications;
    if (targets.length === 0 || unpublishing) return;
    setUnpublishing(true);
    try {
      const results = await Promise.allSettled(targets.map((c) => setPublished(c.id, false)));
      const okIds = new Set(targets.filter((_, i) => results[i]?.status === 'fulfilled').map((c) => c.id));
      if (okIds.size > 0) {
        setCards((prev) => (prev ? prev.map((c) => (okIds.has(c.id) ? { ...c, published: false, published_at: null } : c)) : prev));
      }
      const { title, message } = summarizeBulkUnpublish(targets.length, okIds.size);
      Alert.alert(title, message);
    } finally {
      setUnpublishing(false);
    }
  };

  const onUnpublishAllPress = () => {
    if (publications.length === 0 || unpublishing) return;
    Alert.alert(UNPUBLISH_ALL_DIALOG.title, UNPUBLISH_ALL_DIALOG.body, [
      { text: UNPUBLISH_ALL_DIALOG.cancel, style: 'cancel' },
      { text: UNPUBLISH_ALL_DIALOG.confirm, style: 'destructive', onPress: () => { void unpublishAll(); } },
    ]);
  };

  if (cards === null) {
    return (
      <View style={styles.center}>
        {error ? (
          <>
            <Text style={styles.muted}>{error}</Text>
            <BigButton label="Обновить" onPress={() => { void load(); }} />
          </>
        ) : (
          <ActivityIndicator color={colors.accent} size="large" />
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.text} />}
    >
      {offline && <Note tone="neutral">Нет связи — показаны сохранённые данные.</Note>}
      {error && !offline && <Note tone="danger">{error}</Note>}

      <View style={styles.hero}>
        {editing ? (
          <View style={styles.editRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={DEFAULT_NAME}
              placeholderTextColor={colors.textDim}
              style={styles.input}
              maxLength={DISPLAY_NAME_MAX}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => { void saveName(); }}
            />
            <View style={styles.editButtons}>
              <BigButton label="Сохранить" onPress={() => { void saveName(); }} loading={saving} style={styles.editBtn} />
              <BigButton label="Отмена" variant="secondary" onPress={() => setEditing(false)} disabled={saving} style={styles.editBtn} />
            </View>
          </View>
        ) : (
          <Pressable onPress={() => { setDraft(profile?.displayName ?? ''); setEditing(true); }} accessibilityRole="button" accessibilityLabel="Изменить имя">
            <Text style={styles.name}>{profile?.displayName ?? DEFAULT_NAME}</Text>
            <Text style={styles.rename}>{profile ? 'тап, чтобы изменить · до 40 символов' : 'имя загрузится при появлении сети'}</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.statsRow}>
        <Stat label="Сканов" value={scans === null ? '—' : String(scans)} />
        <Stat label="Карточек" value={String(visible.length)} />
        <Stat label="Ячеек" value={String(new Set(visible.map((c) => c.cell_id).filter(Boolean)).size)} />
      </View>

      <View style={styles.block}>
        <SectionLabel>Распределение по тирам</SectionLabel>
        {buckets.map((b) => (
          <View key={String(b.tier)} style={styles.barRow}>
            <Text style={styles.barLabel} numberOfLines={1}>{b.label}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.max(b.count > 0 ? 4 : 0, Math.round((b.count / maxCount) * 100))}%`, backgroundColor: tierColor(b.tier) }]} />
            </View>
            <Text style={styles.barCount}>{b.count}</Text>
          </View>
        ))}
        {visible.length === 0 && <Text style={styles.muted}>Пока нет карточек.</Text>}
      </View>

      {(rarest || farthest) && (
        <View style={styles.highlights}>
          {rarest && <CardTile card={rarest} photoUrl={urls.get(rarest.scan_id)} kind="Редчайшая" caption={`${rarest.score ?? '—'} очков`} onPress={() => openCard(rarest.id)} />}
          {farthest && <CardTile card={farthest.card} photoUrl={urls.get(farthest.card.scan_id)} kind="Самая далёкая" caption={`${formatDistance(farthest.km)} от первой находки`} onPress={() => openCard(farthest.card.id)} />}
        </View>
      )}

      <View style={styles.block}>
        <View style={styles.showcaseHead}>
          <SectionLabel>Мои публикации</SectionLabel>
          <Text style={styles.showcaseCount}>{publicationsValueText(cards ? publications.length : null)}</Text>
        </View>
        {publications.length === 0 ? (
          <Text style={styles.muted}>{PUBLICATIONS_EMPTY_TEXT}</Text>
        ) : (
          <>
            <View style={styles.grid}>
              {publications.map((c) => (
                <View key={c.id} style={styles.gridItemXs}>
                  <CardTile card={c} size="xs" photoUrl={urls.get(c.scan_id)} onPress={() => openCard(c.id)} />
                </View>
              ))}
            </View>
            <Text style={styles.footnote}>{SHOWCASE_PROFILE_FOOTNOTE}</Text>
            <BigButton label="Убрать все публикации" variant="secondary" onPress={onUnpublishAllPress} loading={unpublishing} disabled={unpublishing} />
          </>
        )}
      </View>

      <View style={styles.block}>
        <SectionLabel>Аккаунт</SectionLabel>
        <View style={styles.account}>
          <View style={styles.accountRow}>
            <View style={styles.accountAvatar}>
              <View style={styles.accountDot} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.accountTitle}>{signedIn ? 'Вход через Apple' : 'Анонимный профиль'}</Text>
              <Text style={styles.accountNote}>{signedIn ? 'Коллекция синхронизируется' : 'Коллекция хранится только на этом телефоне'}</Text>
            </View>
          </View>
          <BigButton
            label={signedIn ? 'Выйти' : 'Сохранить коллекцию через Apple'}
            variant="secondary"
            onPress={() => { if (signedIn) setSignedIn(false); else Alert.alert('Скоро', APPLE_SIGNIN_SOON); }}
          />
          <Text style={styles.footnote}>Регистрация не нужна: приложение работает анонимно. Вход только для того, чтобы коллекция пережила смену телефона.</Text>
        </View>
      </View>

      <View style={styles.block}>
        <SectionLabel>Настройки</SectionLabel>
        {serverWiping && <Note tone="neutral">Удаляем данные на сервере…</Note>}
        <SettingsList rows={settings} onPress={onSettingPress} />
        {showPrivacy && <Text style={styles.privacyText}>{PRIVACY_TEXT}</Text>}
        {showPublicationsInfo && <Text style={styles.privacyText}>{publications.length === 0 ? PUBLICATIONS_EMPTY_TEXT : PUBLICATIONS_TEXT}</Text>}
        <Text style={styles.version}>{APP_VERSION}</Text>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 19 },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  muted: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19, color: colors.textMuted },
  hero: { gap: 7 },
  name: { fontFamily: fonts.serif, fontSize: 27, lineHeight: 30, color: colors.text },
  rename: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 17, color: colors.textDim, marginTop: 2 },
  editRow: { gap: 8 },
  editButtons: { flexDirection: 'row', gap: 9 },
  editBtn: { flex: 1 },
  input: { backgroundColor: colors.surface, color: colors.text, fontFamily: fonts.sans, fontSize: 15, borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(63,191,163,0.4)', padding: 12 },
  statsRow: { flexDirection: 'row', gap: 9 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, padding: 15, paddingHorizontal: 13, alignItems: 'flex-start', gap: 5 },
  statValue: { fontFamily: fonts.monoBold, fontSize: 24, lineHeight: 26, color: colors.text },
  statLabel: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 15, color: colors.textMuted },
  block: { gap: 11, padding: 17, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  barLabel: { width: 92, flexShrink: 0, fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 16, color: colors.chipText },
  barTrack: { flex: 1, height: 9, borderRadius: radius.full, backgroundColor: colors.track, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radius.full },
  barCount: { width: 22, textAlign: 'right', fontFamily: fonts.mono, fontSize: 12, color: colors.textMuted },
  highlights: { flexDirection: 'row', gap: 9 },
  showcaseHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  showcaseCount: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 14, color: colors.textDim },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridItemXs: { width: '31%' },
  footnote: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: colors.textDim },
  account: { gap: 13 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  accountAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  accountDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: colors.textDim },
  accountTitle: { fontFamily: fonts.sansSemi, fontSize: 14.5, lineHeight: 19, color: colors.text },
  accountNote: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: colors.textMuted },
  privacyText: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 19, color: colors.textMuted },
  version: { fontFamily: fonts.monoRegular, fontSize: 12, letterSpacing: 0.5, color: colors.textFaint, textAlign: 'center' },
});
