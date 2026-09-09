// Таб-бар (DESIGN_SYSTEM.md «Tab bar»): Камера / Коллекция / Карта / Профиль. Иконки — примитивы из TabIcons,
// подпись 10.5, активный accentBright, неактивный textFaint, фон colors.tabBar, тонкая линия сверху.
// Нативных заголовков у вкладок нет — H1 рисуют сами экраны. Вкладки ленивые — карта монтируется при первом открытии.
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TAB_ICONS } from '../components/TabIcons';
import { CameraScreen } from '../screens/CameraScreen';
import { CollectionScreen } from '../screens/CollectionScreen';
import { MapScreen } from '../screens/MapScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { colors, fonts } from '../theme';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

function icon(name: keyof TabParamList) {
  const Icon = TAB_ICONS[name];
  return function TabIcon({ color }: { color: string }) {
    return <Icon color={color} />;
  };
}

export function TabNavigator() {
  return (
    <Tab.Navigator
      initialRouteName="Camera"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopWidth: 1, borderTopColor: 'rgba(242,244,246,0.07)', paddingTop: 6 },
        tabBarActiveTintColor: colors.accentBright,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontFamily: fonts.sans, fontSize: 10.5, marginTop: 2 },
        lazy: true,
      }}
    >
      <Tab.Screen name="Camera" component={CameraScreen} options={{ title: 'Камера', tabBarIcon: icon('Camera') }} />
      <Tab.Screen name="Collection" component={CollectionScreen} options={{ title: 'Коллекция', tabBarIcon: icon('Collection') }} />
      <Tab.Screen name="Map" component={MapScreen} options={{ title: 'Карта', tabBarIcon: icon('Map') }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Профиль', tabBarIcon: icon('Profile') }} />
    </Tab.Navigator>
  );
}
