import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';

interface Props {
  uri: string;
  size?: number;
  isScale?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}

export function PhotoThumb({ uri, size = 96, isScale, onPress, onRemove }: Props) {
  return (
    <View style={{ width: size }}>
      <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="imagebutton" style={[styles.frame, { width: size, height: size }, isScale && styles.frameScale]}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        {isScale && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>масштаб</Text>
          </View>
        )}
      </Pressable>
      {onRemove && (
        <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel="Удалить фото" style={styles.remove}>
          <Text style={styles.removeText}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border },
  frameScale: { borderColor: colors.accent },
  badge: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.accent, paddingVertical: 2, alignItems: 'center' },
  badgeText: { color: colors.accentText, fontSize: 11, fontWeight: '600' },
  remove: {
    position: 'absolute', top: -spacing.sm, right: -spacing.sm, width: 28, height: 28, borderRadius: radius.full,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  removeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
