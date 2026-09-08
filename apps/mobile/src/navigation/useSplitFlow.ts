// Поток «Расколоть» (spec §7, T2.3): первый раз — экран безопасности (нельзя пропустить), дальше — камера.
import { useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import { isSafetyAcknowledged } from '../lib/prefs';

export function useSplitFlow(): (parentCardId: string) => Promise<void> {
  const navigation = useNavigation();
  return useCallback(async (parentCardId: string) => {
    if (await isSafetyAcknowledged()) navigation.navigate('Tabs', { screen: 'Camera', params: { parentCardId } }, { pop: true });
    else navigation.navigate('Safety', { parentCardId });
  }, [navigation]);
}
