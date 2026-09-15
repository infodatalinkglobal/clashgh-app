import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ApiError,
  endpoints,
  pesewasToGhs,
  relativeTime,
  type ChargeInfo,
  type GameType,
  type Tournament,
} from '../services/api';
import { Config } from '../config';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Screen, TextField } from '../components/ui';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import { providerLabel, toLocalDisplay } from '../utils/phone';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Join'>;

const GAME_LABELS: Record<GameType, string> = {
  efootball: 'eFootball',
  fc_mobile: 'FC Mobile',
  codm: 'CODM',
  dls: 'DLS',
};

/** What the player enters as their in-game ID, per game (agent.md §3 UIDs). */
const UID_HINTS: Record<GameType, string> = {
  efootball: 'Your eFootball User ID (Profile → top of screen)',
  fc_mobile: 'Your FC Mobile Player ID (Settings → About)',
  codm: 'Your CODM UID (Profile → under your name)',
  dls: 'Your DLS Online ID (Profile → Online)',
};

type Step = 'details' | 'paying' | 'paid' | 'failed';

/**
 * Join & Pay (Module 2B). No pay, no play:
 *   1. Player enters their in-game UID → POST /tournaments/:id/join creates
 *      a PENDING registration + a Paystack MoMo charge.
 *   2. The player approves the MoMo prompt on their phone (live) or taps the
 *      dev "simulate" button (stub). We poll /tournaments/:id/me until the
 *      registration flips to `paid` — the webhook/settle is the only thing
 *      that confirms money moved; the app never assumes success.
 *   3. Pending registrations expire after 10 minutes: a visible countdown
 *      mirrors the backend deadline. A previous pending registration can
 *      be resumed from Home ("Finish payment").
 */
export function JoinScreen({ navigation, route }: Props) {
  const { tournamentId, resumeReference, resumeDeadline } = route.params;
  const { profile } = useAuth();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [gameUid, setGameUid] = useState('');
  const [step, setStep] = useState<Step>(resumeReference ? 'paying' : 'details');
  const [charge, setCharge] = useState<ChargeInfo | null>(null);
  const [reference, setReference] = useState<string | null>(resumeReference ?? null);
  const [deadline, setDeadline] = useState<string | null>(resumeDeadline ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const isStub = Config.paystackMode === 'stub';

  // Tournament header info.
  useEffect(() => {
    let cancelled = false;
    endpoints
      .getTournament(tournamentId)
      .then(({ tournament: t }) => {
        if (!cancelled) setTournament(t);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load tournament');
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  // 1s ticker for the pending-payment countdown.
  useEffect(() => {
    if (step !== 'paying') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step]);

  const secondsLeft = deadline ? Math.max(0, Math.floor((new Date(deadline).getTime() - now) / 1000)) : null;
  const expired = secondsLeft === 0;

  // Poll my registration while paying — settles when the webhook lands.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkStatus = useCallback(async () => {
    try {
      const { registration } = await endpoints.myRegistration(tournamentId);
      if (registration?.payment_status === 'paid') {
        setStep('paid');
        return true;
      }
      if (!registration) {
        // Pending registration was reaped (expired) — let them start over.
        setStep('failed');
        setError('Your pending registration expired before payment was received.');
        return true;
      }
    } catch {
      // transient — keep polling
    }
    return false;
  }, [tournamentId]);

  useEffect(() => {
    if (step !== 'paying' || expired) return;
    void checkStatus();
    pollRef.current = setInterval(() => void checkStatus(), 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, expired, checkStatus]);

  const uidError = useMemo(() => {
    const v = gameUid.trim();
    if (v.length === 0) return null;
    if (v.length > 64) return 'Too long (max 64 characters)';
    return null;
  }, [gameUid]);

  const join = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await endpoints.join(tournamentId, gameUid.trim());
      setCharge(res.charge);
      setReference(res.charge.reference);
      setDeadline(res.registration.payment_deadline);
      setStep('paying');
      // Live Paystack: hand off to the MoMo authorization page. The user
      // approves the USSD/push prompt on their phone; we keep polling.
      if (res.charge.authorization_url) {
        try {
          const WebBrowser = await import('expo-web-browser');
          void WebBrowser.openBrowserAsync(res.charge.authorization_url);
        } catch {
          // browser unavailable — the MoMo prompt still arrives on the phone
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && /pending registration/i.test(e.message)) {
        // Already have a pending one — resume it.
        const { registration } = await endpoints.myRegistration(tournamentId).catch(() => ({ registration: null }));
        if (registration?.payment_status === 'pending') {
          setReference(registration.payment_reference);
          setDeadline(registration.payment_deadline);
          setStep('paying');
          setBusy(false);
          return;
        }
      }
      setError(e instanceof Error ? e.message : 'Could not join');
    } finally {
      setBusy(false);
    }
  };

  /** Dev only: play the role of the Paystack webhook. */
  const simulate = async (success: boolean) => {
    if (!reference) return;
    setBusy(true);
    setError(null);
    try {
      await endpoints.simulateCharge(reference, success);
      if (success) await checkStatus();
    } catch (e) {
      // A declined charge comes back as { success:false } (registration stays
      // pending, still payable) — the client surfaces that as an ApiError.
      if (!success) setError('Payment declined (simulated). Your slot is still held — you can approve again.');
      else setError(e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setBusy(false);
    }
  };

  const fee = tournament ? pesewasToGhs(tournament.entry_fee_pesewas) : '…';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen style={{ padding: 0 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
          <Button label="‹ Back" variant="ghost" onPress={() => navigation.goBack()} style={{ alignSelf: 'flex-start', minHeight: 36, paddingVertical: spacing.xs }} />

          {/* Tournament summary */}
          <View style={styles.card}>
            {tournament ? (
              <>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Badge label={GAME_LABELS[tournament.game]} tone="gold" />
                  <Badge label={`${tournament.max_players} players`} />
                </View>
                <Text style={styles.title}>{tournament.title}</Text>
                <Row k="Entry fee" v={fee} strong />
                <Row k="1st place" v={pesewasToGhs(tournament.projection_if_full.first_prize_pesewas)} />
                <Row k="Runner-up" v={pesewasToGhs(tournament.projection_if_full.runnerup_prize_pesewas)} />
                <Row k="Spots left" v={`${tournament.spots_left} of ${tournament.max_players}`} />
                <Row k="Registration closes" v={relativeTime(tournament.closes_at)} />
                <Row k="Kick-off" v={new Date(tournament.starts_at).toLocaleString()} />
              </>
            ) : (
              <Text style={styles.meta}>Loading tournament…</Text>
            )}
          </View>

          {error ? <Text style={{ color: colors.red, fontSize: typography.caption }}>{error}</Text> : null}

          {step === 'details' && tournament ? (
            <>
              <TextField
                label={`Your ${GAME_LABELS[tournament.game]} ID`}
                value={gameUid}
                onChangeText={setGameUid}
                placeholder="e.g. 123456789"
                hint={UID_HINTS[tournament.game]}
                error={uidError}
                autoFocus
              />
              <View style={styles.payBox}>
                <Text style={styles.meta}>
                  Pay with {profile?.momo_provider ? providerLabel(profile.momo_provider) : 'Mobile Money'}
                  {profile?.phone ? ` · ${toLocalDisplay(profile.phone)}` : ''}
                </Text>
                <Text style={styles.meta2}>
                  Your spot is held for 10 minutes while you approve the charge. Fees are held in escrow and
                  refunded in full if the lobby doesn't fill by close time.
                </Text>
              </View>
              <Button
                label={`Pay ${fee} & join`}
                busy={busy}
                disabled={!tournament.can_join || gameUid.trim().length === 0 || !!uidError}
                onPress={() => void join()}
              />
              {!tournament.can_join ? (
                <Text style={styles.meta2}>This tournament is no longer accepting players.</Text>
              ) : null}
            </>
          ) : null}

          {step === 'paying' ? (
            <View style={{ gap: spacing.md }}>
              <Text style={styles.stepTitle}>{expired ? 'Slot released' : 'Approve the payment on your phone'}</Text>
              {expired ? (
                <Text style={styles.meta}>
                  The 10-minute hold ended before payment was confirmed. Go back and join again if spots remain.
                </Text>
              ) : (
                <>
                  <Text style={styles.meta}>
                    {charge?.note && !isStub
                      ? charge.note
                      : `A ${fee} MoMo prompt is sent to ${profile?.phone ? toLocalDisplay(profile.phone) : 'your number'}. Enter your PIN to approve — this screen updates automatically.`}
                  </Text>
                  <View style={styles.countdown}>
                    <Text style={{ color: colors.gold, fontSize: typography.title, fontWeight: fontWeights.bold }}>
                      {secondsLeft === null ? '—' : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
                    </Text>
                    <Text style={styles.meta2}>slot held · waiting for confirmation</Text>
                  </View>
                  {reference ? <Text style={styles.meta2}>Ref {reference}</Text> : null}
                  {charge?.authorization_url ? (
                    <Button
                      label="Open payment page again"
                      variant="secondary"
                      onPress={() => {
                        void import('expo-web-browser').then((wb) => wb.openBrowserAsync(charge.authorization_url as string));
                      }}
                    />
                  ) : null}
                  {isStub ? (
                    <View style={styles.devBox}>
                      <Text style={styles.meta2}>DEV MODE — no real money. Simulate the Paystack webhook:</Text>
                      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                        <Button label="Approve" busy={busy} onPress={() => void simulate(true)} style={{ flex: 1 }} />
                        <Button label="Decline" variant="secondary" busy={busy} onPress={() => void simulate(false)} style={{ flex: 1 }} />
                      </View>
                    </View>
                  ) : null}
                </>
              )}
              <Button label="Back to tournaments" variant="ghost" onPress={() => navigation.navigate('Home')} />
            </View>
          ) : null}

          {step === 'paid' ? (
            <View style={{ gap: spacing.md, alignItems: 'center', paddingVertical: spacing.xl }}>
              <Badge label="Payment confirmed" tone="green" />
              <Text style={styles.stepTitle}>You're in! 🎉</Text>
              <Text style={[styles.meta, { textAlign: 'center' }]}>
                Your {fee} entry is in escrow. The bracket is drawn when the lobby fills; your match room and
                opponent's ID appear at kick-off{tournament ? ` (${relativeTime(tournament.starts_at)})` : ''}.
              </Text>
              <Button label="Back to tournaments" onPress={() => navigation.navigate('Home')} style={{ alignSelf: 'stretch' }} />
            </View>
          ) : null}

          {step === 'failed' ? (
            <Button label="Try again" onPress={() => { setStep('details'); setError(null); setReference(null); }} />
          ) : null}
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Row({ k, v, strong = false }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text style={styles.meta}>{k}</Text>
      <Text style={{ color: strong ? colors.gold : colors.text, fontSize: typography.caption, fontWeight: strong ? fontWeights.bold : fontWeights.medium }}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold },
  stepTitle: { color: colors.text, fontSize: typography.subheading, fontWeight: fontWeights.semibold },
  meta: { color: colors.textMuted, fontSize: typography.caption },
  meta2: { color: colors.textFaint, fontSize: typography.tiny },
  payBox: { gap: spacing.xs, padding: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md },
  countdown: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  devBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
});
