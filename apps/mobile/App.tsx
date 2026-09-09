import { GolosText_400Regular, GolosText_500Medium, GolosText_600SemiBold, GolosText_700Bold } from '@expo-google-fonts/golos-text';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { PlayfairDisplay_400Regular, PlayfairDisplay_500Medium, PlayfairDisplay_600SemiBold } from '@expo-google-fonts/playfair-display';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { useFonts } from 'expo-font';
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
  // Шрифты дизайн-системы (docs/design/DESIGN_SYSTEM.md). Пока грузятся — пустой тёмный экран,
  // при ошибке загрузки приложение всё равно стартует на системных шрифтах.
  const [fontsLoaded, fontsError] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_600SemiBold,
    GolosText_400Regular,
    GolosText_500Medium,
    GolosText_600SemiBold,
    GolosText_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  // Анонимная сессия и строка lithos.users — в фоне при старте; при сбое повторится на отправке.
  useEffect(() => {
    if (ENV_OK) ensureUser().catch((e) => logError('bootstrap', e));
  }, []);

  useEffect(() => {
    if (fontsError) logError('fonts', fontsError);
  }, [fontsError]);

  if (!ENV_OK) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{MSG.envMissing}</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  if (!fontsLoaded && !fontsError) {
    return <View style={styles.center} />;
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
