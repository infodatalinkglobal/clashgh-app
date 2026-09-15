import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ApiError,
  endpoints,
  pesewasToGhs,
  relativeTime,
  type GameType,
  type HostEarnings,
  type HostLimits,
  type HostStatus,
  type HostTournament,
} from '../services/api';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Eyebrow, FadeIn, Screen, TextField } from '../components/ui';
import { GAMES, colors, fontWeights, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Host'>;

const SIZES = [4, 8, 16, 32, 64];
const CUTS = [0, 5, 10, 15, 20];
const CLOSE_IN_HOURS = [2, 6, 12, 24, 48];
const START_AFTER_HOURS = [1, 2, 6, 12, 24];

/**
 * Host Studio — the marketplace side of ClashGH.
 *   none/pending/suspended → application card
 *   approved               → earnings, "new tournament" form with a live
 *                            money split preview, list of my tournaments
 * Money: entry fees still go into ClashGH escrow; after the final, prizes
 * pay out and the host cut is split 50/50 host/ClashGH straight to MoMo.
 */
export function HostScreen({ navigation }: Props) {
  const { profile, refreshProfile } = useAuth();
  const [status, setStatus] = useState<HostStatus>(profile?.host_status ?? 'none');
  const [limits, setLimits] = useState<HostLimits | null>(null);
  const [earnings, setEarnings] = useState<HostEarnings | null>(null);
  const [mine, setMine] = useState<HostTournament[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const h = await endpoints.myHost();
      setStatus(h.host_status);
      setLimits(h.limits);
      setEarnings(h.earnings);
      if (h.host_status === 'approved') {
        const r = await endpoints.hostTournaments();
        setMine(r.tournaments);
        setEarnings(r.earnings);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load host profile');
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl }}>
        <Button label="‹ Back" variant="ghost" onPress={() => navigation.goBack()} style={{ alignSelf: 'flex-start', minHeight: 36, paddingVertical: spacing.xs }} />
        <View>
          <Eyebrow color={colors.cyan}>Marketplace</Eyebrow>
          <Text style={styles.title}>Host Studio</Text>
        </View>
        {error ? <Text style={{ color: colors.red, fontSize: typography.caption }}>{error}</Text> : null}

        {status !== 'approved' ? (
          <ApplyCard
            status={status}
            note={profile?.host_note ?? null}
            limits={limits}
            busy={busy}
            onApply={async (note) => {
              setBusy(true);
              try {
                await endpoints.applyHost(note);
                await refreshProfile();
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Application failed');
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <>
            <FadeIn>
              <View style={styles.earnCard}>
                <LinearGradient colors={['rgba(34,211,238,0.18)', 'rgba(255,198,26,0.08)', 'rgba(7,9,13,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
                <Eyebrow color={colors.cyan}>Host earnings</Eyebrow>
                <Text style={styles.big}>{pesewasToGhs(earnings?.earned_pesewas ?? 0)}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.lg }}>
                  <Stat label="Hosted" value={String(earnings?.hosted_count ?? 0)} />
                  <Stat label="Completed" value={String(earnings?.completed_count ?? 0)} />
                  {earnings && earnings.pending_pesewas > 0 ? <Stat label="On its way" value={pesewasToGhs(earnings.pending_pesewas)} color={colors.gold} /> : null}
                </View>
                <Text style={styles.meta2}>Paid to your MoMo automatically after each final, alongside the prizes.</Text>
              </View>
            </FadeIn>

            {creating && limits ? (
              <CreateForm
                limits={limits}
                busy={busy}
                onCancel={() => setCreating(false)}
                onSubmit={async (body) => {
                  setBusy(true);
                  setError(null);
                  try {
                    const { tournament } = await endpoints.createHostTournament(body);
                    setCreating(false);
                    await load();
                    navigation.navigate('Tournament', { tournamentId: tournament.id });
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : 'Could not publish');
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ) : (
              <Button label="+ New tournament" onPress={() => setCreating(true)} />
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ width: 4, height: 18, backgroundColor: colors.gold, borderRadius: 2 }} />
              <Text style={styles.section}>My tournaments</Text>
            </View>
            {mine.length === 0 ? <Text style={styles.meta}>Nothing published yet. Your first cup is one tap away.</Text> : null}
            {mine.map((t, i) => (
              <FadeIn key={t.id} delay={i * 50}>
                <Pressable onPress={() => navigation.navigate('Tournament', { tournamentId: t.id })} style={({ pressed }) => [styles.row, { borderLeftColor: GAMES[t.game].accent }, pressed && { opacity: 0.85 }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{t.title}</Text>
                    <Text style={styles.meta2}>
                      {GAMES[t.game].label} · {t.paid_count}/{t.max_players} paid · {t.status === 'open' ? `closes ${relativeTime(t.closes_at)}` : t.status.replace('_', ' ')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={[styles.amount, { color: t.host_share_status === 'success' ? colors.green : colors.textMuted }]}>
                      {t.status === 'completed' && t.host_share_pesewas !== null
                        ? `+${pesewasToGhs(t.host_share_pesewas)}`
                        : `~${pesewasToGhs(t.projection_if_full.host_share_pesewas)}`}
                    </Text>
                    {t.status === 'open' || t.status === 'full' ? (
                      <Pressable
                        hitSlop={8}
                        onPress={() => confirm('Cancel this tournament? Every paid player is refunded in full.', async () => {
                          try { await endpoints.cancelHostTournament(t.id); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Cancel failed'); }
                        })}
                      >
                        <Text style={{ color: colors.red, fontSize: typography.tiny, fontWeight: fontWeights.semibold }}>Cancel</Text>
                      </Pressable>
                    ) : (
                      <Badge label={t.status === 'cancelled' ? 'refunded' : t.host_share_status ?? t.status} tone={t.status === 'cancelled' ? 'red' : t.host_share_status === 'success' ? 'green' : 'muted'} />
                    )}
                  </View>
                </Pressable>
              </FadeIn>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function confirm(message: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(message)) onYes();
  } else {
    Alert.alert('Are you sure?', message, [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel tournament', style: 'destructive', onPress: onYes }]);
  }
}

function ApplyCard({ status, note, limits, busy, onApply }: { status: HostStatus; note: string | null; limits: HostLimits | null; busy: boolean; onApply: (note: string) => void }) {
  const [text, setText] = useState('');
  const hostPct = limits ? 100 - limits.platform_commission_percent : 50;
  return (
    <FadeIn>
      <View style={styles.card}>
        <LinearGradient colors={['rgba(255,198,26,0.14)', 'rgba(7,9,13,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <Text style={styles.h2}>Run your own cups. Get paid.</Text>
        <Text style={styles.meta}>
          Bring your community — WhatsApp group, gaming centre, campus league — and host paid tournaments on ClashGH.
          We handle payments, brackets, disputes and payouts.
        </Text>
        <View style={{ gap: spacing.xs }}>
          <Bullet>You set the game, entry fee, lobby size, times and your cut (up to {limits?.host_cut_max_percent ?? 20}%).</Bullet>
          <Bullet>Players pay into ClashGH escrow — you never touch their money.</Bullet>
          <Bullet>After the final, your cut is split {hostPct}/{limits?.platform_commission_percent ?? 50} with ClashGH and sent to your MoMo.</Bullet>
        </View>
        {status === 'pending' ? (
          <>
            <Badge label="Application under review" tone="gold" />
            {note ? <Text style={styles.meta2}>“{note}”</Text> : null}
            <Text style={styles.meta2}>We usually answer within 24 hours. You'll get an email and a notification.</Text>
          </>
        ) : status === 'suspended' ? (
          <>
            <Badge label="Host access suspended" tone="red" />
            {note ? <Text style={styles.meta2}>Reason: {note}</Text> : null}
          </>
        ) : (
          <>
            <TextField
              label="Tell us about your community"
              value={text}
              onChangeText={setText}
              placeholder="e.g. I run a 300-member CODM WhatsApp group in Kumasi and host weekly friendlies."
              multiline
              autoCapitalize="sentences"
              hint="At least 10 characters. A verified MoMo number is required."
            />
            <Button label="Apply to host" busy={busy} disabled={text.trim().length < 10} onPress={() => onApply(text.trim())} />
          </>
        )}
      </View>
    </FadeIn>
  );
}

function CreateForm({ limits, busy, onCancel, onSubmit }: {
  limits: HostLimits; busy: boolean; onCancel: () => void;
  onSubmit: (b: Parameters<typeof endpoints.createHostTournament>[0]) => void;
}) {
  const [title, setTitle] = useState('');
  const [game, setGame] = useState<GameType>('efootball');
  const [feeGhs, setFeeGhs] = useState('10');
  const [size, setSize] = useState(8);
  const [cut, setCut] = useState(10);
  const [closeIn, setCloseIn] = useState(24);
  const [startAfter, setStartAfter] = useState(2);
  const [rules, setRules] = useState('');

  const fee = Math.round((Number(feeGhs) || 0) * 100);
  const preview = useMemo(() => {
    const total = fee * size;
    const prizePct = 100 - cut;
    const first = Math.floor((total * Math.round(prizePct * 0.78)) / 100); // 78/22 of prize pool ≈ classic 70/20
    const firstPct = Math.round(prizePct * 0.78);
    const runnerupPct = prizePct - firstPct;
    const runnerup = Math.floor((total * runnerupPct) / 100);
    const remainder = total - first - runnerup;
    const host = Math.floor((remainder * (100 - limits.platform_commission_percent)) / 100);
    return { total, first, runnerup, host, platform: remainder - host, firstPct, runnerupPct };
  }, [fee, size, cut, limits.platform_commission_percent]);

  const feeError = fee < limits.min_entry_fee_pesewas ? `Minimum entry is ${pesewasToGhs(limits.min_entry_fee_pesewas)}` : null;
  const prizeFloorError = preview.runnerup < 1000 ? 'Runner-up prize must reach ₵10 — raise the fee or lobby size' : null;
  const canSubmit = title.trim().length >= 3 && !feeError && !prizeFloorError;

  return (
    <FadeIn>
      <View style={[styles.card, { borderColor: colors.borderBright }]}>
        <Text style={styles.h2}>New tournament</Text>
        <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Kumasi CODM Clash #1" autoCapitalize="words" />

        <Eyebrow>Game</Eyebrow>
        <View style={styles.chips}>
          {(Object.keys(GAMES) as GameType[]).map((g) => (
            <Chip key={g} label={GAMES[g].label} active={game === g} accent={GAMES[g].accent} onPress={() => setGame(g)} />
          ))}
        </View>

        <TextField label="Entry fee (₵)" value={feeGhs} onChangeText={setFeeGhs} keyboardType="number-pad" error={feeError} />

        <Eyebrow>Players</Eyebrow>
        <View style={styles.chips}>{SIZES.map((n) => <Chip key={n} label={String(n)} active={size === n} onPress={() => setSize(n)} />)}</View>

        <Eyebrow>Your cut</Eyebrow>
        <View style={styles.chips}>{CUTS.map((c) => <Chip key={c} label={`${c}%`} active={cut === c} onPress={() => setCut(c)} />)}</View>

        <Eyebrow>Registration closes in</Eyebrow>
        <View style={styles.chips}>{CLOSE_IN_HOURS.map((h) => <Chip key={h} label={`${h}h`} active={closeIn === h} onPress={() => setCloseIn(h)} />)}</View>

        <Eyebrow>Kick-off after close</Eyebrow>
        <View style={styles.chips}>{START_AFTER_HOURS.map((h) => <Chip key={h} label={`${h}h`} active={startAfter === h} onPress={() => setStartAfter(h)} />)}</View>

        <TextField label="House rules (optional)" value={rules} onChangeText={setRules} placeholder="Best of 1 · no custom teams · screenshots required" multiline autoCapitalize="sentences" />

        {/* Live money preview */}
        <View style={styles.preview}>
          <LinearGradient colors={['rgba(255,198,26,0.12)', 'rgba(7,9,13,0)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <Eyebrow color={colors.gold}>If the lobby fills · {pesewasToGhs(preview.total)} collected</Eyebrow>
          <Line k={`🥇 Champion (${preview.firstPct}%)`} v={pesewasToGhs(preview.first)} />
          <Line k={`🥈 Runner-up (${preview.runnerupPct}%)`} v={pesewasToGhs(preview.runnerup)} />
          <View style={styles.hr} />
          <Line k="You earn" v={pesewasToGhs(preview.host)} color={colors.green} strong />
          <Line k="ClashGH fee" v={pesewasToGhs(preview.platform)} />
          {prizeFloorError ? <Text style={{ color: colors.red, fontSize: typography.tiny }}>{prizeFloorError}</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button label="Discard" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
          <Button
            label="Publish"
            busy={busy}
            disabled={!canSubmit}
            style={{ flex: 2 }}
            onPress={() => {
              const now = Date.now();
              const closes = new Date(now + closeIn * 3_600_000 + 60_000);
              const starts = new Date(closes.getTime() + startAfter * 3_600_000 + 60_000);
              onSubmit({
                title: title.trim(),
                game,
                entry_fee_pesewas: fee,
                max_players: size,
                closes_at: closes.toISOString(),
                starts_at: starts.toISOString(),
                first_place_percent: preview.firstPct,
                runnerup_percent: preview.runnerupPct,
                rules_text: rules.trim() || undefined,
              });
            }}
          />
        </View>
      </View>
    </FadeIn>
  );
}

function Chip({ label, active, accent = colors.gold, onPress }: { label: string; active: boolean; accent?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: active ? accent : colors.surfaceAlt, borderColor: active ? accent : colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
      <Text style={{ color: active ? '#0A0C10' : colors.textMuted, fontSize: typography.caption, fontWeight: fontWeights.bold }}>{label}</Text>
    </Pressable>
  );
}
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <Text style={{ color: colors.gold }}>▸</Text>
      <Text style={[styles.meta, { flex: 1 }]}>{children}</Text>
    </View>
  );
}
function Line({ k, v, color = colors.text, strong = false }: { k: string; v: string; color?: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={[styles.meta, strong && { color: colors.text, fontWeight: fontWeights.semibold }]}>{k}</Text>
      <Text style={{ color, fontSize: strong ? typography.subheading : typography.caption, fontWeight: fontWeights.bold, fontVariant: ['tabular-nums'] }}>{v}</Text>
    </View>
  );
}
function Stat({ label, value, color = colors.text }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.meta2}>{label}</Text>
      <Text style={{ color, fontSize: typography.body, fontWeight: fontWeights.bold }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: typography.title, fontWeight: fontWeights.black, letterSpacing: -0.5 },
  h2: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold },
  section: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.semibold },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md, overflow: 'hidden' },
  earnCard: { backgroundColor: colors.surface, borderColor: 'rgba(34,211,238,0.35)', borderWidth: 1, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.sm, overflow: 'hidden' },
  big: { color: colors.cyan, fontSize: 40, fontWeight: fontWeights.black, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  preview: { backgroundColor: colors.bg, borderColor: 'rgba(255,198,26,0.35)', borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, overflow: 'hidden' },
  hr: { height: 1, backgroundColor: colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderLeftWidth: 3, borderRadius: radius.md, padding: spacing.md },
  rowTitle: { color: colors.text, fontSize: typography.body, fontWeight: fontWeights.semibold },
  amount: { fontSize: typography.body, fontWeight: fontWeights.bold, fontVariant: ['tabular-nums'] },
  meta: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 19 },
  meta2: { color: colors.textFaint, fontSize: typography.tiny },
});
