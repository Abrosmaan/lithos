import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function BigButton({ label, onPress, variant = 'primary', disabled, loading, style }: Props) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      style={({ pressed }) => [styles.base, styles[variant], off && styles.disabled, pressed && !off && styles.pressed, style]}
    >
      {loading ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.label}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 56, paddingHorizontal: spacing.lg, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  label: { color: colors.accentText, fontSize: 18, fontWeight: '600' },
});
