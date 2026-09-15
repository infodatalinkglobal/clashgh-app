import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { endpoints } from './api';

/**
 * Expo push registration (Module 3E).
 *
 * Called once the player is signed in + onboarded. Asks for permission,
 * gets the Expo push token for this device and registers it with the
 * backend (PUT /api/me/push-token). Web has no push — silently no-op.
 * Failures are swallowed: push is a convenience, never a blocker.
 *
 * expo-notifications / expo-device are imported lazily so the web bundle
 * (and Expo Go quirks) never break the sign-in flow.
 */
let registeredToken: string | null = null;

export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const Device = await import('expo-device');
    if (!Device.isDevice) return null; // emulators have no push credentials
    const Notifications = await import('expo-notifications');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Match & payment alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#F5B800',
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;

    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (token && token !== registeredToken) {
      await endpoints.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
      registeredToken = token;
    }
    return token ?? null;
  } catch (err) {
    console.warn('[push] registration skipped:', (err as Error).message);
    return null;
  }
}

/** On sign-out: unlink this device so the next account doesn't get our alerts. */
export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  try {
    await endpoints.removePushToken(registeredToken);
  } catch {
    // best effort
  }
  registeredToken = null;
}

/** Foreground behaviour: show the banner even while the app is open. */
export async function configureForegroundNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // not available (Expo Go on some SDKs) — fine
  }
}
