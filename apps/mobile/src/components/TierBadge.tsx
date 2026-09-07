import type { Tier } from '@lithos/shared';
import { StyleSheet, Text, View } from 'react-native';
import { tierLabel } from '../lib/card-facts';
import type { CardVerification } from '../lib/card-types';
import { radius, spacing, tierColor } from '../theme';

interface Props {
  tier: Tier | null;
  verification?: CardVerification;
  size?: 'sm' | 'lg';
}

/** Тир по-русски на цветной плашке; «?» при pending_review; «Без редкости» без гео. */
export function TierBadge({ tier, verification = 'ai', size = 'sm' }: Props) {
  const color = verification === 'pending_review' ? tierColor(null) : tierColor(tier);
  return (
    <View style={[styles.badge, size === 'lg' && styles.badgeLg, { backgroundColor: color }]}>
      <Text style={[styles.text, size === 'lg' && styles.textLg]}>{tierLabel(tier, verification)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.full },
  badgeLg: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  text: { color: '#fff', fontSize: 13, fontWeight: '700' },
  textLg: { fontSize: 17 },
});
