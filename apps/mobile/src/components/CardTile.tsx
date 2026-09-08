import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { displayName, rockClassRu } from '../lib/card-facts';
import type { CardRow } from '../lib/card-types';
import { colors, radius, spacing, tierColor } from '../theme';
import { TierBadge } from './TierBadge';

interface Props {
  card: CardRow;
  /** Signed URL лицевого фото; нет — заглушка цвета тира. */
  photoUrl?: string;
  onPress: () => void;
  /** Подпись вместо породы (например, «12 км от первой находки»). */
  caption?: string;
}

/** Плитка сетки коллекции/витрины: фото, имя, тир. */
export function CardTile({ card, photoUrl, onPress, caption }: Props) {
  const accent = card.verification === 'pending_review' ? tierColor(null) : tierColor(card.tier);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={displayName(card)} style={({ pressed }) => [styles.tile, { borderColor: accent }, pressed && styles.pressed]}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.photo} contentFit="cover" transition={150} cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.photo, styles.placeholder, { backgroundColor: accent }]}>
          <Text style={styles.placeholderText}>{rockClassRu(card.rock_class).slice(0, 1)}</Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{displayName(card)}</Text>
        <Text style={styles.sub} numberOfLines={1}>{caption ?? rockClassRu(card.rock_class)}</Text>
        <View style={styles.row}>
          <TierBadge tier={card.tier} verification={card.verification} />
          <Text style={styles.score}>{card.score !== null ? card.score : '—'}</Text>
        </View>
        {(card.provisional || card.state === 'opened') && (
          <Text style={styles.marks} numberOfLines={1}>
            {[card.provisional ? 'предварительно' : null, card.state === 'opened' ? 'раскрыт' : null].filter(Boolean).join(' · ')}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, overflow: 'hidden' },
  pressed: { opacity: 0.8 },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: colors.surfaceActive },
  placeholder: { alignItems: 'center', justifyContent: 'center', opacity: 0.6 },
  placeholderText: { color: '#fff', fontSize: 40, fontWeight: '800' },
  body: { padding: spacing.sm + 2, gap: 2 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  sub: { color: colors.textMuted, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  score: { color: colors.text, fontSize: 14, fontWeight: '600' },
  marks: { color: colors.warning, fontSize: 12, fontWeight: '600' },
});
