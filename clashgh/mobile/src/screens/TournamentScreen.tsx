import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  endpoints,
  pesewasToGhs,
  relativeTime,
  type BracketMatch,
  type BracketView,
  type RegistrationView,
  type Tournament,
} from '../services/api';
import { Config } from '../config';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Countdown, Eyebrow, FadeIn, GameTile, LiveDot, Screen } from '../components/ui';
import { Bracket } from '../components/Bracket';
import { GAMES, colors, fontWeights, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Tournament'>;

/**
 * Tournament View (Module 2C): prize pool + split, schedule, my status
 * and the full bracket with my position highlighted. Public endpoints
 * (tournament, bracket) + my registration. Polls modestly while the
 * tournament is live (agent.md §14) and refreshes on focus.
 */
export function TournamentScreen({ navigation, route }: Props) {
  const { tournamentId } = route.params;
  const { profile } = useAuth();
  const [t, setT] = useState<Tournament | null>(null);
  const [bracket, setBracket] = useState<BracketView | null>(null);
  const [reg, setReg] = useState<RegistrationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ tournament }, b, { registration }] = await Promise.all([
        endpoints.getTournament(tournamentId),
        endpoints.getBracket(tournamentId),
        endpoints.myRegistration(tournamentId).catch(() => ({ registration: null })),
      ]);
      setT(tournament);
      setBracket(b);
      setReg(registration);
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      if (!t) setError(e instanceof Error ? e.message : 'Could not load tournament');
    } finally {
      setRefreshing(false);
    }
  }, [tournamentId, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Poll while live so advancement shows up without a manual refresh.
  useEffect(() => {
    if (t?.status !== 'in_progress') return;
    const id = setInterval(() => void load(), Config.matchPollMs);
    return () => clearInterval(id);
  }, [t?.status, load]);

  const meId = profile?.id ?? null;
  const myMatch: BracketMatch | null =
    bracket?.rounds
      .flatMap((r) => r.matches)
      .filter((m) => m.player1?.id === meId || m.player2?.id === meId)
      .sort((a, b) => b.match_number - a.match_number)
      .find((m) => m.status !== 'completed') ??
    bracket?.rounds
      .flatMap((r) => r.matches)
      .find((m) => (m.player1?.id === meId || m.player2?.id === meId) && m.status === 'completed') ??
    null;

  const eliminated = !!myMatch && myMatch.status === 'completed' && myMatch.winner !== meId;
  const champion = bracket && t?.status === 'completed' && bracket.rounds.at(-1)?.matches[0]?.winner === meId;

  const first = t ? (t.prize_pool_pesewas !== null ? firstFromPool(t) : t.projection_if_full.first_prize_pesewas) : null;
  const runnerUp = t ? (t.prize_pool_pesewas !== null ? t.prize_pool_pesewas - (first ?? 0) : t.projection_if_full.runnerup_prize_pesewas) : null;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.gold}
          />
        }
      >
        <View style={styles.hero}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Text style={{ color: colors.text, fontSize: typography.body, fontWeight: fontWeights.semibold }}>‹ Back</Text>
          </Pressable>
          {t ? (
            <FadeIn style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                <GameTile code={GAMES[t.game].code} accent={GAMES[t.game].accent} size={48} />
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Text style={styles.gameLabel}>{GAMES[t.game].label}</Text>
                    {t.status === 'in_progress' ? (
                      <View style={styles.livePill}><LiveDot size={6} /><Text style={styles.liveText}>Live</Text></View>
                    ) : (
                      <Badge label={t.status.replace('_', ' ')} tone={t.status === 'cancelled' ? 'red' : t.status === 'open' ? 'green' : 'muted'} />
                    )}
                    {reg?.payment_status === 'paid' ? <Badge label="You're in" tone="green" /> : null}
                    {champion ? <Badge label="Champion" tone="gold" /> : eliminated ? <Badge label="Eliminated" tone="muted" /> : null}
                  </View>
                  <Text style={styles.title}>{t.title}</Text>
                </View>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: typography.caption }}>
                {t.host ? `Hosted by @${t.host.username ?? 'host'} · payments and results handled by ClashGH` : 'Official ClashGH tournament'}
              </Text>
              {t.status === 'open' ? (
                <Countdown to={t.closes_at} prefix="Registration closes in " style={{ color: colors.text, fontSize: typography.caption, fontWeight: fontWeights.medium }} />
              ) : t.status === 'full' ? (
                <Countdown to={t.starts_at} prefix="Kick-off in " style={{ color: colors.text, fontSize: typography.caption, fontWeight: fontWeights.medium }} />
              ) : (
                <Text style={styles.meta}>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</Text>
              )}
            </FadeIn>
          ) : null}
        </View>

        <View style={{ padding: spacing.xl, paddingTop: 0, gap: spacing.lg }}>
        {error && !t ? <Text style={{ color: colors.red }}>{error}</Text> : null}
        {!t ? <Text style={styles.meta}>Loading…</Text> : null}

        {t ? (
          <>
            {/* Prize pool */}
            <View style={[styles.card, styles.prizeCard]}>
              <Eyebrow>{t.prize_pool_pesewas !== null ? 'Prize pool' : 'Prize pool (if lobby fills)'}</Eyebrow>
              <Text style={styles.big}>{pesewasToGhs(t.prize_pool_pesewas ?? t.projection_if_full.first_prize_pesewas + t.projection_if_full.runnerup_prize_pesewas)}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.lg }}>
                <Split label="Champion" value={pesewasToGhs(first)} pct={t.first_place_percent} />
                <Split label="Runner-up" value={pesewasToGhs(runnerUp)} pct={t.runnerup_percent} />
              </View>
              <Text style={styles.meta2}>
                Entry {pesewasToGhs(t.entry_fee_pesewas)} × {t.max_players} players · {100 - t.first_place_percent - t.runnerup_percent}% {t.host ? 'host & platform fee' : 'platform fee'}
              </Text>
            </View>

            {t.rules_text ? (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>House rules from the host</Text>
                <Text style={{ color: colors.text, fontSize: typography.caption, lineHeight: 19 }}>{t.rules_text}</Text>
              </View>
            ) : null}

            {/* Schedule */}
            <View style={styles.card}>
              <Row k="Players" v={`${t.paid_count}/${t.max_players} paid${t.spots_left > 0 && t.status === 'open' ? ` · ${t.spots_left} left` : ''}`} />
              <Row k="Registration closes" v={`${new Date(t.closes_at).toLocaleString()} (${relativeTime(t.closes_at)})`} />
              <Row k="Kick-off" v={`${new Date(t.starts_at).toLocaleString()} (${relativeTime(t.starts_at)})`} />
              <Row k="Result window" v={`${t.result_window_minutes} min per match`} />
            </View>

            {/* Actions */}
            {reg?.payment_status === 'pending' ? (
              <Button
                label="Finish payment"
                onPress={() => navigation.navigate('Join', { tournamentId: t.id, resumeReference: reg.payment_reference, resumeDeadline: reg.payment_deadline })}
              />
            ) : !reg && t.can_join ? (
              <Button label={`Join for ${pesewasToGhs(t.entry_fee_pesewas)}`} onPress={() => navigation.navigate('Join', { tournamentId: t.id })} />
            ) : null}

            {myMatch && (myMatch.status === 'active' || myMatch.status === 'awaiting_results' || myMatch.status === 'disputed') ? (
              <Button
                label={myMatch.status === 'active' ? 'Go to your match room' : myMatch.status === 'disputed' ? 'View disputed match' : 'View match (awaiting result)'}
                onPress={() => navigation.navigate('Match', { matchId: myMatch.id })}
              />
            ) : null}

            {/* Bracket */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
              <Text style={styles.section}>Bracket</Text>
            </View>
            {bracket?.bracket_generated ? (
              <Bracket
                bracket={bracket}
                meId={meId}
                onPressMatch={(m) => navigation.navigate('Match', { matchId: m.id })}
              />
            ) : t.status === 'cancelled' ? (
              <Text style={styles.meta}>This tournament was cancelled. All paid entries were refunded.</Text>
            ) : (
              <View style={[styles.card, { alignItems: 'center' }]}>
                <Text style={styles.meta}>
                  The draw happens when all {t.max_players} spots are paid.
                </Text>
                <Text style={styles.big}>{t.paid_count}/{t.max_players}</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.round((t.paid_count / t.max_players) * 100)}%` }]} />
                </View>
                <Text style={styles.meta2}>
                  If the lobby isn't full by close time, everyone is refunded.
                </Text>
              </View>
            )}

            {reg?.payment_status === 'paid' ? (
              <Text style={styles.meta2}>Your in-game ID for this cup: {reg.game_uid}</Text>
            ) : null}
          </>
        ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** first prize = floor(total × first%/100), total = pool + platform fee. */
function firstFromPool(t: Tournament): number {
  const total = (t.prize_pool_pesewas ?? 0) + (t.platform_fee_pesewas ?? 0);
  return Math.floor((total * t.first_place_percent) / 100);
}

function Split({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={styles.meta2}>{label} · {pct}%</Text>
      <Text style={{ color: colors.text, fontSize: typography.subheading, fontWeight: fontWeights.semibold }}>{value}</Text>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text style={styles.meta}>{k}</Text>
      <Text style={{ color: colors.text, fontSize: typography.caption, fontWeight: fontWeights.medium, flexShrink: 1, textAlign: 'right' }}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { padding: spacing.xl, gap: spacing.lg },
  back: { alignSelf: 'flex-start' },
  gameLabel: { color: colors.textMuted, fontSize: typography.tiny, fontWeight: fontWeights.semibold, letterSpacing: 0.6, textTransform: 'uppercase' },
  livePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(229,72,77,0.12)', borderRadius: radius.pill, paddingRight: spacing.sm, paddingVertical: 1 },
  liveText: { color: colors.red, fontSize: typography.tiny, fontWeight: fontWeights.semibold },
  prizeCard: {},
  title: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold, letterSpacing: -0.3 },
  section: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.semibold },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardLabel: { color: colors.textMuted, fontSize: typography.tiny, letterSpacing: 1, textTransform: 'uppercase' },
  big: { color: colors.text, fontSize: typography.display, fontWeight: fontWeights.bold, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  meta: { color: colors.textMuted, fontSize: typography.caption },
  meta2: { color: colors.textFaint, fontSize: typography.tiny },
  progressTrack: { alignSelf: 'stretch', height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.gold },
});
