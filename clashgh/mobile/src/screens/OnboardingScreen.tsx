import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Logo, Screen, TextField } from '../components/ui';
import { colors, fontWeights, spacing, typography } from '../theme';
import { detectProvider, isValidUsername, providerLabel, toE164, toLocalDisplay } from '../utils/phone';
import { usePageTitle } from '../utils/pageTitle';

/**
 * One-time onboarding: username + MoMo number.
 *
 * No SMS OTP (decision 2026-09-15). The number is proven by money, not
 * by a code: in live mode the backend resolves the registered account
 * name via Paystack so the player sees "MTN · KOFI MENSAH" before
 * confirming, and the first entry fee is approved on that very phone.
 * Set once, then locked: the same number pays and receives prizes.
 */
export function OnboardingScreen() {
  usePageTitle('Set up your account');
  const { profile, setProfileUsername, resolveMomo, saveMomo, busy, error, dismissError } = useAuth();

  const [username, setUsername] = useState(profile?.username ?? '');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'details' | 'confirm'>('details');
  const [accountName, setAccountName] = useState<string | null>(null);

  const e164 = useMemo(() => toE164(phone), [phone]);
  const provider = useMemo(() => detectProvider(phone), [phone]);

  const usernameError =
    username.length > 0 && !isValidUsername(username)
      ? '3-20 characters: lowercase letters, numbers, underscore'
      : null;
  const phoneError =
    phone.length > 0 && !e164
      ? 'Enter a Ghana number, e.g. 0244123456'
      : phone.length > 0 && e164 && !provider
        ? 'That prefix is not a supported MoMo number'
        : null;

  const check = async () => {
    dismissError();
    try {
      if (!profile?.username && username) await setProfileUsername(username);
      const r = await resolveMomo(e164 as string);
      setAccountName(r.account_name);
      setStep('confirm');
    } catch {
      // error surfaced via context
    }
  };

  const confirm = async () => {
    dismissError();
    try {
      await saveMomo(e164 as string);
    } catch {
      // error surfaced via context
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ alignItems: 'flex-start' }}>
          <Logo size={36} />
          <Text style={{ color: colors.textMuted, fontSize: typography.caption, marginTop: spacing.sm }}>
            Welcome{profile?.username ? `, ${profile.username}` : ''}. One quick step before you play.
          </Text>
        </View>

        {error ? <Text style={{ color: colors.red, fontSize: typography.caption }}>{error}</Text> : null}

        {step === 'details' ? (
          <>
            <TextField
              label="Username"
              value={username}
              onChangeText={(t) => setUsername(t.toLowerCase())}
              placeholder="e.g. kofi_striker"
              hint="Lowercase letters, numbers, underscore (3-20)"
              error={usernameError}
            />
            <TextField
              label="MoMo number"
              value={phone}
              onChangeText={setPhone}
              placeholder="0244123456"
              keyboardType="phone-pad"
              hint={
                provider
                  ? `${providerLabel(provider)}. This number pays entry fees and receives prizes`
                  : 'Your Mobile Money number. The same number pays and receives.'
              }
              error={phoneError}
            />
            {provider ? <Badge label={providerLabel(provider)} tone="gold" /> : null}
            <Button
              label="Continue"
              busy={busy}
              disabled={!e164 || !provider || !!usernameError || (username.length === 0 && !profile?.username)}
              onPress={() => void check()}
            />
            <Text style={{ color: colors.textFaint, fontSize: typography.tiny }}>
              No code to type. You confirm the number once; your first entry fee is approved on that phone, and
              that is what proves it is yours. It cannot be changed afterwards without contacting support.
            </Text>
          </>
        ) : (
          <>
            <Text style={{ color: colors.text, fontSize: typography.subheading, fontWeight: fontWeights.semibold }}>
              Is this your MoMo number?
            </Text>
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: spacing.md,
                gap: spacing.xs,
              }}
            >
              <Text style={{ color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold }}>
                {toLocalDisplay(e164)}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: typography.caption }}>
                {providerLabel(provider!)}
                {accountName ? ` · registered to ${accountName}` : ''}
              </Text>
            </View>
            <Text style={{ color: colors.textMuted, fontSize: typography.caption }}>
              Entry fees are charged to this number and every prize is sent back to it. Once saved it is locked
              to your account.
            </Text>
            <Button label="Yes, save this number" busy={busy} onPress={() => void confirm()} />
            <Button
              label="Change number"
              variant="ghost"
              onPress={() => {
                setStep('details');
                setAccountName(null);
              }}
            />
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
