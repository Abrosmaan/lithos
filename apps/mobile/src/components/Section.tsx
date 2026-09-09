import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type } from '../theme';
import { SectionLabel } from './ui';

/** Секция карточки: mono-подпись + содержимое, без подложки (DESIGN_SYSTEM.md, экран «Карточка»). */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.wrap}>
      <SectionLabel>{title}</SectionLabel>
      {children}
    </View>
  );
}

export function Line({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={muted ? type.small : type.body}>{children}</Text>;
}

const styles = StyleSheet.create({
  wrap: { gap: 9 },
});
