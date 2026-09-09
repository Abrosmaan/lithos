// Экран «Анализ» (DESIGN_SYSTEM.md, экран 5): кольцо-спиннер 118px вокруг «камня», Playfair «Определяем камень…»,
// подпись ступени и список пяти ступеней с точками (пройденные — accentBright).
import type { ScanStage } from '@lithos/shared';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { RESULT_MSG, STAGES, stageIndex, stageStatusText } from '../lib/result-text';
import { colors, fonts, placeholderStripes } from '../theme';

const RING = 118;

export function Analyzing({ stage }: { stage: ScanStage | null }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1150, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const current = stageIndex(stage);

  return (
    <View style={styles.wrap} accessible accessibilityLabel={`${RESULT_MSG.determining} ${stageStatusText(stage)}`}>
      <View style={styles.ringBox}>
        <View style={styles.ringTrack} />
        <Animated.View style={[styles.ringArc, { transform: [{ rotate }] }]} />
        <View style={styles.stone} />
      </View>
      <View style={styles.titles}>
        <Text style={styles.h2}>{RESULT_MSG.determining}</Text>
        <Text style={styles.sub}>{stageStatusText(stage)}</Text>
      </View>
      <View style={styles.list}>
        {STAGES.map((label, i) => {
          const passed = i <= current;
          return (
            <View key={label} style={styles.row}>
              <View style={[styles.dot, passed && styles.dotOn]} />
              <Text style={[styles.stage, passed && styles.stageOn]}>{label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32, padding: 34, backgroundColor: colors.bg },
  ringBox: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringTrack: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: 1.5, borderColor: 'rgba(242,244,246,0.09)' },
  ringArc: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: 1.5, borderColor: 'transparent', borderTopColor: colors.accentBright },
  stone: { width: 56, height: 56, borderTopLeftRadius: 25, borderTopRightRadius: 31, borderBottomRightRadius: 29, borderBottomLeftRadius: 27, backgroundColor: placeholderStripes.b },
  titles: { alignItems: 'center', gap: 9 },
  h2: { fontFamily: fonts.serif, fontSize: 24, lineHeight: 29, color: colors.text, textAlign: 'center' },
  sub: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 20, color: colors.textMuted, textAlign: 'center' },
  list: { gap: 10, width: '100%', maxWidth: 262 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  dot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: 'rgba(242,244,246,0.14)' },
  dotOn: { backgroundColor: colors.accentBright },
  stage: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 17, color: colors.textFaint },
  stageOn: { color: colors.text },
});
