// Появление блока: opacity 0→1 + сдвиг снизу (lfade / lrise / lcard из прототипа). Задержка — как в CSS-анимациях.
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

interface Props {
  children: ReactNode;
  /** Задержка в мс (прототип: .18 / .62 / .78 с). */
  delay?: number;
  duration?: number;
  /** Сдвиг снизу в px; lcard — 14, lfade — 6. */
  rise?: number;
  /** Ключ: при смене анимация проигрывается заново (например, новая карточка). */
  replayKey?: string | number | null;
  style?: StyleProp<ViewStyle>;
}

export function FadeIn({ children, delay = 0, duration = 450, rise = 6, replayKey = null, style }: Props) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    const anim = Animated.timing(v, { toValue: 1, duration, delay, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [v, delay, duration, replayKey]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] });
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY }] }]}>{children}</Animated.View>;
}
