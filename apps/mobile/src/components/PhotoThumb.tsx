// Миниатюра фото (камера 60px, проверка 94px): рамка 1.5px (accent — снимок с масштабом), mono-тег в углу,
// плашка «масштаб» accent, крестик из примитивов (две повёрнутые полоски) вместо глифа.
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

interface Props {
  uri: string;
  size?: number;
  isScale?: boolean;
  /** Подпись в углу mono 8px (номер снимка). */
  tag?: string;
  onPress?: () => void;
  onRemove?: () => void;
}

/** Крестик из двух полосок — камера, проверка, закрытие. */
export function CrossGlyph({ size = 9, color = colors.text, thickness = 1.5 }: { size?: number; color?: string; thickness?: number }) {
  const bar = { position: 'absolute' as const, width: size, height: thickness, backgroundColor: color };
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[bar, { transform: [{ rotate: '45deg' }] }]} />
      <View style={[bar, { transform: [{ rotate: '-45deg' }] }]} />
    </View>
  );
}

export function PhotoThumb({ uri, size = 94, isScale, tag, onPress, onRemove }: Props) {
  const small = size < 80;
  const radius = small ? 12 : 14;
  const removeSize = small ? 18 : 20;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={isScale ? 'Фото с масштабом' : 'Фото камня'}
      style={[styles.frame, { width: size, height: size, borderRadius: radius }, isScale && styles.frameScale]}
    >
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      {tag ? <Text style={[styles.tag, small ? styles.tagSmall : styles.tagLarge]}>{tag}</Text> : null}
      {isScale && !small && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>масштаб</Text>
        </View>
      )}
      {onRemove && (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel="Удалить фото"
          hitSlop={8}
          style={[styles.remove, { width: removeSize, height: removeSize, borderRadius: removeSize / 2, top: small ? 3 : 5, right: small ? 3 : 5 }]}
        >
          <CrossGlyph size={small ? 9 : 10} />
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: '#1e2632', borderWidth: 1.5, borderColor: 'rgba(242,244,246,0.14)' },
  frameScale: { borderColor: colors.accent },
  tag: { position: 'absolute', fontFamily: fonts.monoRegular, fontSize: 8, lineHeight: 9, color: '#7b8794' },
  tagSmall: { left: 5, bottom: 4 },
  tagLarge: { left: 6, bottom: 5 },
  badge: { position: 'absolute', left: 5, top: 5, paddingVertical: 3, paddingHorizontal: 7, borderRadius: 7, backgroundColor: colors.accent },
  badgeText: { fontFamily: fonts.sansSemi, fontSize: 10, lineHeight: 12, color: colors.accentText },
  remove: { position: 'absolute', backgroundColor: 'rgba(11,15,20,0.85)', alignItems: 'center', justifyContent: 'center' },
});
