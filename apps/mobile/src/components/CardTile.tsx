// Плитка карточки (DESIGN_SYSTEM.md «Tile»): фото + 2px шов цвета тира + флаг «предварительно»/«раскрыт» +
// имя Playfair + порода + внизу тир цветом и score mono. Тир — материал: рамка плитки нейтральная, цвет только в шве.
// Размеры: md — коллекция/профиль (фото density.tile), sm — дневник (82), xs — витрина (70).
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { displayName, rockClassRu, tierLabel } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { scoreText, tileFlag } from '../lib/screen-text';
import { colors, density, fonts, radius, tierColor, type } from '../theme';
import { PhotoPlaceholder } from './ui';

export type TileSize = 'md' | 'sm' | 'xs';

interface Props {
  card: CardRow;
  /** Signed URL лицевого фото; нет — полосатый плейсхолдер. */
  photoUrl?: string;
  onPress: () => void;
  size?: TileSize;
  /** Подпись вместо породы (профиль: «88 очков», «1,2 км от первой находки»). */
  caption?: string;
  /** Плашка вида на фото («Редчайшая», «Самая далёкая») — вместо флага статуса. */
  kind?: string;
}

const PHOTO_HEIGHT: Record<TileSize, number> = { md: density.tile, sm: 82, xs: 70 };

export function CardTile({ card, photoUrl, onPress, size = 'md', caption, kind }: Props) {
  const pending = card.verification === 'pending_review';
  const accent = pending ? colors.textFaint : tierColor(card.tier);
  const flag = kind ?? tileFlag(card);
  const height = PHOTO_HEIGHT[size];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${displayName(card)}, ${tierLabel(card.tier, card.verification)}`}
      style={({ pressed }) => [styles.tile, sizeStyles[size].tile, pressed && styles.pressed]}
    >
      <View style={{ height }}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" />
        ) : (
          <PhotoPlaceholder height={height} style={styles.placeholder} />
        )}
        {flag && size !== 'xs' ? (
          <View style={styles.flag}>
            <Text style={[styles.flagText, kind ? { color: colors.text } : null]}>{flag}</Text>
          </View>
        ) : null}
        <View style={[styles.seam, { backgroundColor: accent }]} />
      </View>
      <View style={sizeStyles[size].body}>
        <Text style={sizeStyles[size].name} numberOfLines={size === 'md' ? 2 : 1}>{displayName(card)}</Text>
        {size === 'md' ? (
          <>
            <Text style={styles.rock} numberOfLines={1}>{caption ?? rockClassRu(card.rock_class)}</Text>
            <View style={styles.footer}>
              <Text style={[styles.tier, { color: accent }]} numberOfLines={1}>{tierLabel(card.tier, card.verification)}</Text>
              <Text style={styles.score}>{scoreText(card)}</Text>
            </View>
          </>
        ) : null}
        {size === 'sm' ? <Text style={[styles.tierSm, { color: accent }]} numberOfLines={1}>{tierLabel(card.tier, card.verification)}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  pressed: { opacity: 0.85 },
  placeholder: { borderRadius: 0, minHeight: 0 },
  flag: { position: 'absolute', top: 7, left: 7, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 7, backgroundColor: colors.scrim },
  flagText: { fontFamily: fonts.sansSemi, fontSize: 10, color: colors.goldText },
  seam: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 },
  rock: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 15, color: colors.textMuted },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 3 },
  tier: { flex: 1, fontFamily: fonts.sansSemi, fontSize: 11 },
  score: { fontFamily: fonts.monoBold, fontSize: 12, color: colors.chipText },
  tierSm: { fontFamily: fonts.sansSemi, fontSize: 10.5 },
});

const sizeStyles = {
  md: StyleSheet.create({
    tile: { borderRadius: radius.lg },
    body: { paddingTop: 11, paddingHorizontal: 11, paddingBottom: 13, gap: 5 },
    name: type.tileName,
  }),
  sm: StyleSheet.create({
    tile: { borderRadius: radius.md },
    body: { paddingTop: 9, paddingHorizontal: 10, paddingBottom: 11, gap: 3 },
    name: { ...type.tileName, fontSize: 13, lineHeight: 16 },
  }),
  xs: StyleSheet.create({
    tile: { borderRadius: 12 },
    body: { paddingTop: 7, paddingHorizontal: 8, paddingBottom: 9 },
    name: { ...type.tileName, fontSize: 11, lineHeight: 14 },
  }),
} as const;
