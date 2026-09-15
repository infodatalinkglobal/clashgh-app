import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AuthProvider } from './src/store/AuthContext';
import { configureForegroundNotifications } from './src/services/push';

// 3E: show push banners while the app is in the foreground (no-op on web).
void configureForegroundNotifications();

/**
 * ClashGH — entry point.
 * Session bootstrap (token → profile) happens inside AuthProvider before
 * the navigation renders, so the user never sees a flash of the wrong
 * screen.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
