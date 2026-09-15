import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Config } from '../config';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Logo, Screen, TextField } from '../components/ui';
import { colors, fontWeights, spacing, typography } from '../theme';
import {
  detectProvider,
  isValidUsername,
  providerLabel,
  toE164,
  toLocalDisplay,
} from '../utils/phone';

/**
 * One-time onboarding (Module 2A): username + MoMo number + OTP.
 *
 * The phone number is the ONE number that both pays and receives
 * (user decision: "phone number for paid is the same to receive") —
 * verified exactly once, here, via SMS OTP. No repeated OTPs.
 */
export function OnboardingScreen() {
  const { profile, setProfileUsername, requestPhoneOtp, verifyPhoneOtp, busy, error, dismissError } =
    useAuth();

  const [username, setUsername] = useState(profile?.username ?? '');
  const [phone, setPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'details' | 'code'>(profile?.username ? 'details' : 'details');

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

  const sendCode = async () => {
    dismissError();
    try {
      if (!profile?.username && username) {
        await setProfileUsername(username);
      }
      await requestPhoneOtp(e164 as string);
      setOtpSent(true);
      setStep('code');
    } catch {
      // error surfaced via context
    }
  };

  const verify = async () => {
    dismissError();
    try {
      await verifyPhoneOtp(e164 as string, otp.trim());
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
            Welcome{profile?.username ? `, ${profile.username}` : ''} — one quick step to start playing
          </Text>
        </View>

        {error ? (
          <Text style={{ color: colors.red, fontSize: typography.caption }}>{error}</Text>
        ) : null}

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
                  ? `Will be verified via SMS — pays and receives: ${providerLabel(provider)}`
                  : 'Your Mobile Money number — the same number pays and receives'
              }
              error={phoneError}
            />
            {provider ? (
              <Badge label={providerLabel(provider)} tone="gold" />
            ) : null}
            <Button
              label="Send verification code"
              busy={busy}
              disabled={!e164 || !provider || !!usernameError || (username.length === 0 && !!profile?.username === false)}
              onPress={() => void sendCode()}
            />
            <Text style={{ color: colors.textFaint, fontSize: typography.tiny }}>
              Verified once, never again. OTP expires after {Config.otpExpiryMinutes} minutes.
            </Text>
          </>
        ) : (
          <>
            <Text style={{ color: colors.text, fontSize: typography.subheading, fontWeight: fontWeights.semibold }}>
              Code sent to {toLocalDisplay(e164)}
            </Text>
            <TextField
              label="6-digit code"
              value={otp}
              onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              keyboardType="number-pad"
              autoFocus
              onSubmit={() => void verify()}
            />
            <Button label="Verify & finish" busy={busy} disabled={otp.length !== 6} onPress={() => void verify()} />
            <Button
              label={`Change number (${toLocalDisplay(e164)})`}
              variant="ghost"
              onPress={() => {
                setStep('details');
                setOtpSent(false);
              }}
            />
            <Text style={{ color: colors.textFaint, fontSize: typography.tiny }}>
              In dev mode the code is printed in the API server console (mock SMS provider).
            </Text>
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
