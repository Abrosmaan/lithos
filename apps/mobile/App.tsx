import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ensureUser } from './src/lib/auth';
import { ENV_OK } from './src/lib/env';
import { logError, MSG } from './src/lib/errors';
import { ScanDraftProvider } from './src/lib/scan-draft';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors, spacing } from './src/theme';

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, primary: colors.accent, border: colors.border },
};

export default function App() {
  // Анонимная сессия и строка lithos.users — в фоне при старте; при сбое повторится на отправке.
  useEffect(() => {
    if (ENV_OK) ensureUser().catch((e) => logError('bootstrap', e));
  }, []);

  if (!ENV_OK) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{MSG.envMissing}</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ScanDraftProvider>
        <NavigationContainer theme={navTheme}>
          <RootNavigator />
        </NavigationContainer>
      </ScanDraftProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.bg },
  text: { color: colors.text, fontSize: 16, textAlign: 'center' },
});
