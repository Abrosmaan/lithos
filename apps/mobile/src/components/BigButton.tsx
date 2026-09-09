import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, fonts, radius } from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  /** primary — accent; secondary — surface с рамкой; danger — раскол (полупрозрачный красный); ghost — текстовая ссылка. */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

/** Кнопки дизайн-системы (DESIGN_SYSTEM.md «Компоненты»). */
export function BigButton({ label, onPress, variant = 'primary', disabled, loading, style }: Props) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => [styles.base, styles[variant], off && variant === 'primary' && styles.disabledPrimary, off && variant !== 'primary' && styles.disabled, pressed && !off && styles.pressed, style]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.accentText : colors.text} />
      ) : (
        <Text style={[styles.label, labelStyles[variant], off && variant === 'primary' && { color: colors.textFaint }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 56, paddingVertical: 17, paddingHorizontal: 20, borderRadius: radius.lg, backgroundColor: colors.accent },
  secondary: { minHeight: 50, paddingVertical: 15, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(242,244,246,0.1)' },
  danger: { minHeight: 50, paddingVertical: 15, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.dangerTint, borderWidth: 1, borderColor: colors.dangerBorder },
  ghost: { minHeight: 36, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: 'transparent' },
  disabledPrimary: { backgroundColor: colors.surfaceDim },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
  label: { fontFamily: fonts.sansSemi, textAlign: 'center' },
});

const labelStyles = StyleSheet.create({
  primary: { fontSize: 16, color: colors.accentText },
  secondary: { fontSize: 14.5, color: colors.text },
  danger: { fontSize: 14.5, color: colors.dangerText },
  ghost: { fontSize: 13.5, color: colors.textMuted },
});
