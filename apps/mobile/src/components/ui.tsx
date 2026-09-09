// Базовые элементы дизайн-системы (docs/design/DESIGN_SYSTEM.md, раздел «Компоненты»).
// Только оформление: никаких порогов и балансовых чисел.
import type { Tier } from '@lithos/shared';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { colors, density, fonts, radius, spacing, tierColor, type } from '../theme';

/** Подпись секции: mono 10, uppercase, разрядка. «ПОРОДА», «ОЖИДАЕМЫЕ ПОРОДЫ». */
export function SectionLabel({ children, color, style }: { children: ReactNode; color?: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[type.sectionLabel, color ? { color } : null, style]}>{children}</Text>;
}

/** Кружок с mono-номером шага — приветствие, подсказка первого запуска, безопасность (gold). */
export function StepNumber({ n, tone = 'accent' }: { n: string | number; tone?: 'accent' | 'gold' }) {
  const gold = tone === 'gold';
  return (
    <View style={[styles.stepCircle, gold && styles.stepCircleGold]}>
      <Text style={[type.stepNumber, gold && { color: colors.gold, fontSize: 13 }]}>{n}</Text>
    </View>
  );
}

/** Шаг: кружок + заголовок + текст. */
export function StepRow({ n, title, body, tone }: { n: string | number; title: string; body?: string; tone?: 'accent' | 'gold' }) {
  return (
    <View style={styles.stepRow}>
      <StepNumber n={n} tone={tone} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.bodyStrong}>{title}</Text>
        {body ? <Text style={type.small}>{body}</Text> : null}
      </View>
    </View>
  );
}

/** Рамка карточки результата/карточки: surface, radius 22, border цвета тира (или divider, пока уточняем). */
export function CardFrame({ tier, refining, children, style }: { tier: Tier | null | undefined; refining?: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const border = refining ? colors.borderStrong : tierColor(tier ?? null);
  return <View style={[styles.cardFrame, { borderColor: border }, style]}>{children}</View>;
}

/** 3px шов цвета тира по низу фото; появляется масштабированием слева направо. */
export function TierSeam({ tier, animate = true, height = 3 }: { tier: Tier | null | undefined; animate?: boolean; height?: number }) {
  const scale = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    scale.setValue(0);
    const t = setTimeout(() => Animated.timing(scale, { toValue: 1, duration: 600, useNativeDriver: true }).start(), 500);
    return () => clearTimeout(t);
  }, [animate, scale, tier]);
  return (
    <Animated.View
      style={[styles.seam, { height, backgroundColor: tierColor(tier ?? null), transform: [{ scaleX: scale }] }]}
      pointerEvents="none"
    />
  );
}

/** «Шов и цифра»: слева ТИР + название Playfair цветом тира, справа score mono 34 + «/ 100». */
export function TierLine({ tierName, tier, scoreText, size = 'lg', pendingReview }: { tierName: string; tier: Tier | null | undefined; scoreText: string; size?: 'lg' | 'md'; pendingReview?: boolean }) {
  const color = pendingReview ? colors.textFaint : tierColor(tier ?? null);
  return (
    <View style={styles.tierLine}>
      <View style={{ gap: 4 }}>
        <SectionLabel>тир</SectionLabel>
        <Text style={[type.tierName, { color }]}>{tierName}</Text>
      </View>
      <View style={styles.scoreRow}>
        <Text style={size === 'lg' ? type.scoreBig : type.scoreMid}>{scoreText}</Text>
        <Text style={styles.scoreDenom}>/ 100</Text>
      </View>
    </View>
  );
}

/** Золотая плашка-примечание: «Без редкости», «Тир ?», «Предварительно», «Без геопозиции…». */
export function Note({ children, tone = 'gold', style }: { children: ReactNode; tone?: 'gold' | 'danger' | 'neutral'; style?: StyleProp<ViewStyle> }) {
  const t = tone === 'danger' ? styles.noteDanger : tone === 'neutral' ? styles.noteNeutral : styles.noteGold;
  const c = tone === 'danger' ? colors.dangerTextSoft : tone === 'neutral' ? colors.textMuted : colors.goldText;
  return (
    <View style={[styles.note, t, style]}>
      <Text style={[type.small, { color: c }]}>{children}</Text>
    </View>
  );
}

/** Плашка дельты score после раскола: mono, зелёная при росте, красная при падении. */
export function DeltaPill({ text, negative }: { text: string; negative?: boolean }) {
  return (
    <View style={[styles.delta, negative && styles.deltaNeg]}>
      <Text style={[styles.deltaText, negative && { color: colors.dangerText }]}>{text}</Text>
    </View>
  );
}

/** Строка факта с буллетом accentBright. */
export function FactRow({ children }: { children: ReactNode }) {
  return (
    <View style={styles.factRow}>
      <View style={styles.factDot} />
      <Text style={[type.body, { flex: 1 }]}>{children}</Text>
    </View>
  );
}

/** Пара «ключ — значение» для секций карточки. */
export function KeyValue({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.kv}>
      <Text style={[type.small, { flexShrink: 0 }]}>{k}</Text>
      <Text style={[type.body, { flex: 1, textAlign: 'right' }]}>{v}</Text>
    </View>
  );
}

/** Тонкий разделитель. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

/**
 * Золотое сияние легендарной карточки (прототип: radial-gradient + `lhalo`, 0→.6→0 за 1.9с с задержкой .45с).
 * RN не умеет radial-gradient без сторонней либы — приближаем стопкой полупрозрачных кругов убывающей плотности.
 * Проигрывается один раз на смену `replayKey` (id карточки), не на каждый ре-рендер.
 */
export function LegendaryGlow({ replayKey }: { replayKey: string | number | null }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    const anim = Animated.sequence([
      Animated.delay(450),
      Animated.timing(v, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 1050, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [v, replayKey]);
  return (
    <Animated.View style={[styles.glow, { opacity: v }]} pointerEvents="none">
      <View style={styles.glowRing3} />
      <View style={styles.glowRing2} />
      <View style={styles.glowRing1} />
    </Animated.View>
  );
}

/** Пилюля-подсказка над камерой. */
export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'danger' }) {
  return (
    <View style={[styles.pill, tone === 'danger' && styles.pillDanger]}>
      <Text style={[type.body, { fontFamily: fonts.sansMedium }, tone === 'danger' && { color: colors.dangerText, fontSize: 12 }]}>{children}</Text>
    </View>
  );
}

/** Полосатый плейсхолдер фото (пока нет снимка): диагональные полосы как в прототипе. */
export function PhotoPlaceholder({ label, height, style }: { label?: string; height?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.placeholder, height ? { height } : null, style]}>
      {label ? <Text style={styles.placeholderLabel}>{label}</Text> : null}
    </View>
  );
}

/** Строка-ссылка со стрелкой («Дневник этого места ›»). */
export function LinkRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.8 }]}>
      <Text style={type.buttonSm}>{label}</Text>
      <Chevron />
    </Pressable>
  );
}

/** Шеврон из примитивов (без иконок). */
export function Chevron({ direction = 'right', color = colors.textMuted, size = 9 }: { direction?: 'right' | 'down' | 'up' | 'left'; color?: string; size?: number }) {
  const rot = { right: '45deg', down: '135deg', up: '-135deg', left: '-135deg' }[direction];
  const leftLike = direction === 'left';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRightWidth: leftLike ? 0 : 2,
        borderTopWidth: leftLike ? 0 : 2,
        borderLeftWidth: leftLike ? 2 : 0,
        borderBottomWidth: leftLike ? 2 : 0,
        borderColor: color,
        transform: [{ rotate: leftLike ? '45deg' : rot }],
      }}
    />
  );
}

const styles = StyleSheet.create({
  stepCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(63,191,163,0.45)', alignItems: 'center', justifyContent: 'center' },
  stepCircleGold: { width: 28, height: 28, borderRadius: 14, borderWidth: 0, backgroundColor: colors.goldTint },
  stepRow: { flexDirection: 'row', gap: 13, alignItems: 'flex-start' },
  cardFrame: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden' },
  seam: { position: 'absolute', left: 0, right: 0, bottom: 0, transformOrigin: 'left' },
  tierLine: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: colors.divider },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  scoreDenom: { fontFamily: fonts.sans, fontSize: 12, color: colors.textDim },
  note: { paddingVertical: 11, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1 },
  noteGold: { backgroundColor: colors.surfaceAlt, borderColor: 'rgba(224,165,38,0.3)' },
  noteDanger: { backgroundColor: colors.dangerBg, borderColor: 'rgba(176,58,46,0.5)' },
  noteNeutral: { backgroundColor: colors.surfaceAlt, borderColor: colors.borderStrong },
  delta: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.accentTint, borderWidth: 1, borderColor: colors.accentBorder },
  deltaNeg: { backgroundColor: 'rgba(176,58,46,0.12)', borderColor: 'rgba(176,58,46,0.4)' },
  deltaText: { fontFamily: fonts.mono, fontSize: 13.5, lineHeight: 16, color: colors.accentSoft },
  factRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  factDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: colors.accentBright },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, paddingVertical: 2 },
  divider: { height: 1, backgroundColor: colors.divider },
  pill: { paddingVertical: 10, paddingHorizontal: 17, borderRadius: radius.full, backgroundColor: 'rgba(11,15,20,0.74)', borderWidth: 1, borderColor: 'rgba(242,244,246,0.1)' },
  pillDanger: { paddingVertical: 7, paddingHorizontal: 14, backgroundColor: 'rgba(176,58,46,0.15)', borderColor: colors.dangerBorder },
  placeholder: { backgroundColor: '#1e2632', borderRadius: radius.lg, overflow: 'hidden', minHeight: density.tile, alignItems: 'center', justifyContent: 'center' },
  placeholderLabel: { fontFamily: fonts.monoRegular, fontSize: 10, letterSpacing: 1.2, color: '#7b8794' },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  glow: { position: 'absolute', top: '50%', left: '50%', marginLeft: -140, marginTop: -140, width: 280, height: 280, alignItems: 'center', justifyContent: 'center' },
  glowRing1: { position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(224,165,38,0.55)' },
  glowRing2: { position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: 'rgba(224,165,38,0.28)' },
  glowRing3: { position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(224,165,38,0.12)' },
});

export { spacing };
