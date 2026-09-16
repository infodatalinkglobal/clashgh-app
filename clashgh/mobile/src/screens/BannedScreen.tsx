import React from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../store/AuthContext';
import { Button, Logo, Screen } from '../components/ui';
import { colors, fontWeights, spacing, typography } from '../theme';
import { usePageTitle } from '../utils/pageTitle';

/**
 * Shown instead of the app when profile.is_banned. The backend rejects
 * every authenticated call except GET /me for banned accounts, so there is
 * nothing else the player could do here: explain and offer sign-out.
 */
export function BannedScreen() {
  usePageTitle('Account suspended');
  const { profile, signOut, busy } = useAuth();
  return (
    <Screen>
      <Logo size={36} />
      <Text style={{ color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold, marginTop: spacing.lg }}>
        Account suspended
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: typography.body }}>
        {profile?.username ? `${profile.username}, your` : 'Your'} ClashGH account has been suspended by an admin, usually
        after repeated result disputes or a fake screenshot.
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: typography.body }}>
        Any prize you had already won stays yours. If you believe this is a mistake, email support with your
        username.
      </Text>
      <View style={{ marginTop: spacing.xl }}>
        <Button label="Sign out" variant="ghost" busy={busy} onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}
