import React, { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
      <Text style={{ color: colors.text, fontSize: typography.title, fontWeight: fontWeights.black, letterSpacing: -0.5 }}>Account</Text>

      <FadeIn>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.borderBright, padding: spacing.xl, gap: spacing.md, overflow: 'hidden' }}>
        <LinearGradient colors={['rgba(255,198,26,0.16)', 'rgba(7,9,13,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: colors.gold, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', shadowColor: colors.gold, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } }}>
            <Text style={{ color: colors.gold, fontSize: 24, fontWeight: fontWeights.black }}>{(profile.username ?? '?').slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Eyebrow color={colors.gold}>Player</Eyebrow>
            <Text style={{ color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.black }}>
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

      <Button label="Wallet · winnings & fees →" variant="secondary" onPress={() => navigation.navigate('Wallet')} />
      <Button label="Notifications →" variant="secondary" onPress={() => navigation.navigate('Inbox')} />
      <Button
        label={profile.host_status === 'approved' ? '🎙️ Host Studio →' : profile.host_status === 'pending' ? 'Host application · under review →' : '🎙️ Become a host — earn from your own cups →'}
        variant="secondary"
        onPress={() => navigation.navigate('Host')}
      />

      <Button label="Sign out" variant="danger" busy={busy} onPress={() => void signOut()} style={{ marginTop: spacing.lg }} />
      <Text style={{ color: colors.textFaint, fontSize: typography.tiny, textAlign: 'center' }}>ClashGH build {BUILD_STAMP}</Text>
      </ScrollView>
    </Screen>
  );
}
