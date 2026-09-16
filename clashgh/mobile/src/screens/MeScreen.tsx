import React, { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Eyebrow, FadeIn, Screen } from '../components/ui';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import { providerLabel, toLocalDisplay } from '../utils/phone';

const BUILD_STAMP = process.env.EXPO_PUBLIC_BUILD_STAMP ?? 'dev';

/** Account screen: profile, verification state, sign-out. */
export function MeScreen() {
  const { profile, signOut, busy, refreshProfile } = useAuth();
  useFocusEffect(useCallback(() => { void refreshProfile().catch(() => undefined); }, [refreshProfile]));
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  if (!profile) return null;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button label="‹ Back" variant="ghost" onPress={() => navigation.goBack()} style={{ alignSelf: 'flex-start', minHeight: 36, paddingVertical: spacing.xs }} />
        <Button label="Sign out" variant="ghost" busy={busy} onPress={() => void signOut()} style={{ minHeight: 36, paddingVertical: spacing.xs, borderColor: colors.red }} />
      </View>
      <Text style={{ color: colors.text, fontSize: typography.title, fontWeight: fontWeights.bold, letterSpacing: -0.5 }}>Account</Text>

      <FadeIn>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.gold, fontSize: 22, fontWeight: fontWeights.bold }}>{(profile.username ?? '?').slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Eyebrow>Player</Eyebrow>
            <Text style={{ color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold }}>
              {profile.username ?? '(no username)'}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: typography.caption }}>{profile.email}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
          {profile.phone_verified ? (
            <Badge label="Phone verified" tone="green" />
          ) : (
            <Badge label="Phone unverified" tone="red" />
          )}
          {profile.momo_provider ? <Badge label={providerLabel(profile.momo_provider)} tone="gold" /> : null}
          {profile.role === 'admin' ? <Badge label="Admin" tone="gold" /> : null}
          {profile.is_banned ? <Badge label="Banned" tone="red" /> : null}
        </View>
        {profile.phone ? (
          <Text style={{ color: colors.textMuted, fontSize: typography.caption }}>
            MoMo number: {toLocalDisplay(profile.phone)}
          </Text>
        ) : null}
      </View>
      </FadeIn>

      <Text style={{ color: colors.textFaint, fontSize: typography.tiny }}>
        The same MoMo number pays your entry fees and receives your winnings.
      </Text>

      <Button label="Wallet" variant="secondary" onPress={() => navigation.navigate('Wallet')} />
      <Button label="Notifications" variant="secondary" onPress={() => navigation.navigate('Inbox')} />
      <Button
        label={profile.host_status === 'approved' ? 'Host Studio' : profile.host_status === 'pending' ? 'Host application under review' : 'Become a host'}
        variant="secondary"
        onPress={() => navigation.navigate('Host')}
      />

      <Button label="Sign out" variant="danger" busy={busy} onPress={() => void signOut()} style={{ marginTop: spacing.lg }} />
      <Text style={{ color: colors.textFaint, fontSize: typography.tiny, textAlign: 'center' }}>ClashGH build {BUILD_STAMP}</Text>
      </ScrollView>
    </Screen>
  );
}
