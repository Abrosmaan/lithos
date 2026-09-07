import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';

/** Блок карточки: заголовок + содержимое на тёмной подложке. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

export function Line({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.line, muted && styles.muted]}>{children}</Text>;
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  title: { color: colors.textMuted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  line: { color: colors.text, fontSize: 16, lineHeight: 22 },
  muted: { color: colors.textMuted },
});
