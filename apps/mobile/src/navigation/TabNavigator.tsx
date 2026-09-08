// Таб-бар волны 3 (dev-plan T3.x): Камера / Коллекция / Карта / Профиль. Вкладки ленивые — карта монтируется
// при первом открытии. Иконки — эмодзи: в проекте нет набора векторных иконок, а тянуть его ради четырёх глифов не стали.
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text } from 'react-native';
import { CameraScreen } from '../screens/CameraScreen';
import { CollectionScreen } from '../screens/CollectionScreen';
import { MapScreen } from '../screens/MapScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { colors } from '../theme';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

function icon(glyph: string) {
  return function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={[styles.icon, !focused && styles.iconOff]}>{glyph}</Text>;
  };
}

export function TabNavigator() {
  return (
    <Tab.Navigator
      initialRouteName="Camera"
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        lazy: true,
      }}
    >
      <Tab.Screen name="Camera" component={CameraScreen} options={{ title: 'Камера', headerShown: false, tabBarIcon: icon('📷') }} />
      <Tab.Screen name="Collection" component={CollectionScreen} options={{ title: 'Коллекция', tabBarIcon: icon('🗂️') }} />
      <Tab.Screen name="Map" component={MapScreen} options={{ title: 'Карта', tabBarIcon: icon('🗺️') }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Профиль', tabBarIcon: icon('👤') }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 20 },
  iconOff: { opacity: 0.55 },
});
