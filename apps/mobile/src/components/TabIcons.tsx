// Иконки таб-бара из примитивов (DESIGN_SYSTEM.md, принцип 4 «Иконки — геометрия»): рамка с кругом, сетка 2×2,
// ромб-капля, кружок с дугой. Цвет приходит от навигатора (активный accentBright / неактивный textFaint).
import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import type { TabParamList } from '../navigation/types';

export interface TabIconProps {
  color: string;
}

/** Камера: скруглённая рамка 22×17 с кружком-объективом. */
export function CameraTabIcon({ color }: TabIconProps) {
  return (
    <View style={[styles.camera, { borderColor: color }]}>
      <View style={[styles.lens, { borderColor: color }]} />
    </View>
  );
}

/** Коллекция: сетка 2×2. */
export function CollectionTabIcon({ color }: TabIconProps) {
  const cell = [styles.cell, { backgroundColor: color }];
  return (
    <View style={styles.grid}>
      <View style={styles.gridRow}><View style={cell} /><View style={cell} /></View>
      <View style={styles.gridRow}><View style={cell} /><View style={cell} /></View>
    </View>
  );
}

/** Карта: ромб-капля (квадрат 12 с одним острым углом, повёрнут на 45°). */
export function MapTabIcon({ color }: TabIconProps) {
  return (
    <View style={styles.box17}>
      <View style={[styles.drop, { backgroundColor: color }]} />
    </View>
  );
}

/** Профиль: кружок-голова и полукруг-плечи. */
export function ProfileTabIcon({ color }: TabIconProps) {
  return (
    <View style={[styles.box17, styles.profile]}>
      <View style={[styles.head, { backgroundColor: color }]} />
      <View style={[styles.shoulders, { backgroundColor: color }]} />
    </View>
  );
}

export const TAB_ICONS: Record<keyof TabParamList, ComponentType<TabIconProps>> = {
  Camera: CameraTabIcon,
  Collection: CollectionTabIcon,
  Map: MapTabIcon,
  Profile: ProfileTabIcon,
};

const styles = StyleSheet.create({
  camera: { width: 22, height: 17, borderRadius: 5, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  lens: { width: 7, height: 7, borderRadius: 3.5, borderWidth: 1.6 },
  grid: { width: 19, height: 17, gap: 3 },
  gridRow: { flex: 1, flexDirection: 'row', gap: 3 },
  cell: { flex: 1, borderRadius: 2 },
  box17: { width: 17, height: 17, alignItems: 'center', justifyContent: 'center' },
  drop: { width: 12, height: 12, borderTopLeftRadius: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, borderBottomLeftRadius: 10, transform: [{ rotate: '45deg' }] },
  profile: { flexDirection: 'column', gap: 2 },
  head: { width: 8, height: 8, borderRadius: 4 },
  shoulders: { width: 15, height: 7, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
});
