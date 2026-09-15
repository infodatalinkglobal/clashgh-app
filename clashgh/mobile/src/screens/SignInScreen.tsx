import React, { useState } from 'react';
import { ImageBackground, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Config } from '../config';
import { useAuth } from '../store/AuthContext';
import { Button, Eyebrow, FadeIn, Logo, Screen, TextField } from '../components/ui';
import { GAMES, HERO_ART, colors, fontWeights, radius, spacing, typography } from '../theme';

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
        <Screen style={{ padding: 0, gap: 0 }}>
          <ImageBackground source={HERO_ART} style={{ height: 300, justifyContent: 'flex-end' }}>
            <LinearGradient colors={['rgba(7,9,13,0.1)', 'rgba(7,9,13,0.55)', colors.bg]} locations={[0, 0.6, 1]} style={StyleSheet.absoluteFill} />
            <FadeIn style={{ alignItems: 'center', gap: spacing.md, paddingBottom: spacing.sm }}>
              <Logo size={56} />
              <Eyebrow color={colors.cyan}>Ghana's mobile esports arena</Eyebrow>
            </FadeIn>
          </ImageBackground>
          <FadeIn delay={120} style={{ padding: spacing.xl, gap: spacing.xl }}>
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: typography.title, fontWeight: fontWeights.black, textAlign: 'center', letterSpacing: -0.5 }}>
              Entry fee in.{' '}<Text style={{ color: colors.gold }}>Cash out on MoMo.</Text>
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
              {(Object.keys(GAMES) as (keyof typeof GAMES)[]).map((k) => (
                <View key={k} style={{ borderWidth: 1, borderColor: GAMES[k].accent, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                  <Text style={{ color: GAMES[k].accent, fontSize: typography.tiny, fontWeight: fontWeights.bold, letterSpacing: 1 }}>{GAMES[k].label.toUpperCase()}</Text>
                </View>
              ))}
            </View>
          </View>

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
