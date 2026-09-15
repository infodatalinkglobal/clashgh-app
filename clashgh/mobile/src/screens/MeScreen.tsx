import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Screen } from '../components/ui';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import { providerLabel, toLocalDisplay } from '../utils/phone';

/** Account screen: profile, verification state, sign-out. */
export function MeScreen() {
  const { profile, signOut, busy } = useAuth();
  if (!profile) return null;

  return (
    <Screen>
      <Text style={{ color: colors.text, fontSize: typography.title, fontWeight: fontWeights.bold }}>Account</Text>

      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md }}>
        <Text style={{ color: colors.text, fontSize: typography.subheading, fontWeight: fontWeights.semibold }}>
          {profile.username ?? '(no username)'}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: typography.caption }}>{profile.email}</Text>
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

      <Text style={{ color: colors.textFaint, fontSize: typography.tiny }}>
        The same MoMo number pays your entry fees and receives your winnings.
      </Text>

      <View style={{ flex: 1 }} />
      <Button label="Sign out" variant="danger" busy={busy} onPress={() => void signOut()} />
    </Screen>
  );
}
