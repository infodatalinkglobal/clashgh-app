import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Config } from '../config';
import { useAuth } from '../store/AuthContext';
import { Button, FadeIn, Logo, Screen, TextField } from '../components/ui';
import { GAMES, colors, fontWeights, radius, spacing, typography } from '../theme';

/**
 * Sign-in (Module 2A).
 *
 * Primary: Google. Fallback: email magic link (no-GMS devices / Google
 * outages). In dev (stub) mode the Google button presents a clearly
 * labelled identity picker and the magic-link field signs in directly —
 * same backend contract as production, zero credentials needed.
 */
export function SignInScreen() {
  const { signInWithDevIdentity, signInWithGoogle, signInWithEmail, busy, error, dismissError } = useAuth();
  const [devEmail, setDevEmail] = useState('');
  const [showDevPicker, setShowDevPicker] = useState(false);
  const [email, setEmail] = useState('');
  const isStub = Config.authMode === 'stub';

  const onGoogle = () => {
    if (isStub) {
      setShowDevPicker(true);
    } else {
      void signInWithGoogle().catch(() => undefined);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <Screen style={{ justifyContent: 'center', gap: spacing.xl }}>
          <FadeIn style={{ gap: spacing.lg }}>
            <Logo size={48} />
            <View style={{ gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontSize: typography.title, fontWeight: fontWeights.bold, textAlign: 'center', letterSpacing: -0.5 }}>
                Paid mobile-game tournaments
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: typography.body, textAlign: 'center', lineHeight: 22 }}>
                Enter with Mobile Money. Play 1v1 brackets. Winnings are sent to your MoMo number.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
              {(Object.keys(GAMES) as (keyof typeof GAMES)[]).map((k) => (
                <View key={k} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 }}>
                  <Text style={{ color: colors.textMuted, fontSize: typography.tiny, fontWeight: fontWeights.semibold }}>{GAMES[k].label}</Text>
                </View>
              ))}
            </View>
          </FadeIn>
          <FadeIn delay={80} style={{ gap: spacing.xl }}>
          {error ? (
            <Pressable onPress={dismissError} style={{ gap: spacing.xs, alignItems: 'center' }}>
              <Text style={{ color: colors.red, fontSize: typography.caption }}>{error}</Text>
              <Text style={{ color: colors.textFaint, fontSize: typography.tiny }}>(tap to dismiss)</Text>
            </Pressable>
          ) : null}

          {isStub && showDevPicker ? (
            <View style={{ gap: spacing.md, backgroundColor: colors.surface, borderRadius: 10, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.gold, fontSize: typography.caption, fontWeight: fontWeights.semibold }}>
                DEV MODE — choose an identity (simulates Google sign-in)
              </Text>
              <TextField
                label="Email"
                value={devEmail}
                onChangeText={setDevEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                error={devEmail.length > 0 && !devEmail.includes('@') ? 'Enter a valid email' : null}
              />
              <Button
                label="Continue"
                busy={busy}
                onPress={() => void signInWithDevIdentity(devEmail.trim()).catch(() => undefined)}
              />
              <Button label="Back" variant="ghost" onPress={() => setShowDevPicker(false)} />
            </View>
          ) : (
            <View style={{ gap: spacing.md }}>
              <Button label="Sign in with Google" onPress={onGoogle} busy={busy} />
              <View style={{ gap: spacing.sm }}>
                <Text style={{ color: colors.textFaint, fontSize: typography.tiny, textAlign: 'center' }}>
                  or use an email magic link
                </Text>
                <TextField
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  error={email.length > 0 && !email.includes('@') ? 'Enter a valid email' : null}
                  onSubmit={() => void signInWithEmail(email.trim()).catch(() => undefined)}
                />
                <Button
                  label={isStub ? 'Sign in (dev)' : 'Send magic link'}
                  variant="secondary"
                  busy={busy}
                  disabled={email.length === 0 || !email.includes('@')}
                  onPress={() => {
                    if (isStub) void signInWithDevIdentity(email.trim()).catch(() => undefined);
                    else void signInWithEmail(email.trim()).catch(() => undefined);
                  }}
                />
              </View>
            </View>
          )}

          <Text style={{ color: colors.textFaint, fontSize: typography.tiny, textAlign: 'center' }}>
            By continuing you agree to the ClashGH fair-play rules. No betting — entry fee and prize only.
          </Text>
          </FadeIn>
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
