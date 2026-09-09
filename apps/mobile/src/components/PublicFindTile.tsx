// Плитка чужой находки в дневнике места («Здесь находили другие», T6.1-E2). Похожа на CardTile (sm), но
// принимает PublicFindRow — у него нет scan_id/score_breakdown и других полей CardRow, поэтому не натягиваем
// на CardTile фиктивный объект, а держим маленький отдельный компонент с тем же визуальным языком.
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { displayName, rockClassRu, tierLabel } from '../lib/card-facts';
import type { PublicFindRow } from '../lib/publish';
import { colors, fonts, radius, tierColor, type } from '../theme';
import { PhotoPlaceholder } from './ui';

interface Props {
  find: PublicFindRow;
  /** Signed URL лицевого фото (fetchPublicPhotoUrl) — undefined, пока грузится, null, если фото нет. */
  photoUrl?: string | null;
  onPress: () => void;
}

const PHOTO_HEIGHT = 82;

export function PublicFindTile({ find, photoUrl, onPress }: Props) {
  const accent = tierColor(find.tier);
  const name = displayName(find);
  const author = find.author_name ?? 'Без имени';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${tierLabel(find.tier)}, автор ${author}`}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={{ height: PHOTO_HEIGHT }}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" />
        ) : (
          <PhotoPlaceholder height={PHOTO_HEIGHT} style={styles.placeholder} />
        )}
        <View style={[styles.seam, { backgroundColor: accent }]} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <View style={styles.footer}>
          <Text style={[styles.tier, { color: accent }]} numberOfLines={1}>{tierLabel(find.tier)}</Text>
          <Text style={styles.author} numberOfLines={1}>{author}</Text>
        </View>
        <Text style={styles.rock} numberOfLines={1}>{rockClassRu(find.rock_class)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md },
  pressed: { opacity: 0.85 },
  placeholder: { borderRadius: 0, minHeight: 0 },
  seam: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 },
  body: { paddingTop: 9, paddingHorizontal: 10, paddingBottom: 11, gap: 3 },
  name: { ...type.tileName, fontSize: 13, lineHeight: 16 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tier: { fontFamily: fonts.sansSemi, fontSize: 10.5 },
  author: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 10.5, color: colors.textDim, textAlign: 'right' },
  rock: { fontFamily: fonts.sans, fontSize: 10.5, lineHeight: 13, color: colors.textMuted },
});
