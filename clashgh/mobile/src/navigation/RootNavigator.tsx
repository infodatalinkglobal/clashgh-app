import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../store/AuthContext';
import { Config } from '../config';
import { colors } from '../theme';
import { HomeScreen } from '../screens/HomeScreen';
import { JoinScreen } from '../screens/JoinScreen';
import { MatchScreen } from '../screens/MatchScreen';
import { SubmitResultScreen } from '../screens/SubmitResultScreen';
import { TournamentScreen } from '../screens/TournamentScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { MeScreen } from '../screens/MeScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { BannedScreen } from '../screens/BannedScreen';

export type RootStackParamList = {
  Home: undefined;
  Tournament: { tournamentId: string };
  Join: { tournamentId: string; resumeReference?: string; resumeDeadline?: string };
  Match: { matchId: string };
  SubmitResult: { matchId: string };
  Me: undefined;
  Wallet: undefined;
  Onboarding: undefined;
  SignIn: undefined;
};

type StackProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;

const Stack = createNativeStackNavigator<RootStackParamList>();

function Splash() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator color={colors.gold} size="large" />
      <Text style={styles.splashText}>ClashGH</Text>
    </View>
  );
}

/**
 * Auth-gated navigation (Module 2A). The stack is derived from the
 * session state:
 *   no profile        → SignIn
 *   unverified profile → Onboarding (one-time)
 *   verified profile   → Home / Me
 */
export function RootNavigator() {
  const { initializing, profile, isOnboarding, handleAuthUrl } = useAuth();

  // Supabase auth deep link (magic link / OAuth callback).
  useEffect(() => {
    if (Config.authMode !== 'supabase') return;
    let cancelled = false;
    import('expo-linking')
      .then(({ default: Linking }) =>
        Linking.getInitialURL().then((url) => {
          if (!cancelled && url) void handleAuthUrl(url);
        }),
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [handleAuthUrl]);

  if (initializing) return <Splash />;
  if (!profile) return <SignInScreen />;
  if (profile.is_banned) return <BannedScreen />;
  if (isOnboarding) return <OnboardingScreen />;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Tournament" component={TournamentScreen} />
        <Stack.Screen name="Join" component={JoinScreen} />
        <Stack.Screen name="Match" component={MatchScreen} />
        <Stack.Screen name="SubmitResult" component={SubmitResultScreen} />
        <Stack.Screen name="Wallet" component={WalletScreen} />
        <Stack.Screen
          name="Me"
          component={MeScreen}
          options={{ title: 'Account' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  splashText: { color: colors.textMuted, fontSize: 16, letterSpacing: 2 },
});

// Re-export for screens that need typed navigation props later (2B+).
export type { StackProps };
