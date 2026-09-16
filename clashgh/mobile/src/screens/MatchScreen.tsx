import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { endpoints, type MatchPlayerView, type MatchView } from '../services/api';
import { Config } from '../config';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Eyebrow, FadeIn, Screen } from '../components/ui';
import { ScheduleCard } from '../components/ScheduleCard';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Match'>;


/**
 * Match Room (Module 2D). One screen for the whole life of a match:
 *
 *   pending          → opponent + countdown to kick-off (room code hidden)
 *   active           → ROOM CODE revealed, both UIDs, result-window
 *                      countdown, instructions, "Submit result" (2E)
 *   awaiting_results → my pick recorded, waiting for opponent
 *   disputed         → flagged for admin, reason shown
 *   completed        → winner banner (advanced / eliminated)
 *
 * Polls every `matchPollMs` (modest, agent.md §14) while not completed, so
 * the room code appears within a minute of activation without a push.
 */
export function MatchScreen({ navigation, route }: Props) {
  const { matchId } = route.params;
  const { profile } = useAuth();
  const [m, setM] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setM(await endpoints.getMatch(matchId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load match');
    } finally {
      setRefreshing(false);
    }
  }, [matchId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const live = !!m && m.status !== 'completed';
  useEffect(() => {
    if (!live) return;
    const poll = setInterval(() => void load(), Config.matchPollMs);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [live, load]);

  const meId = profile?.id ?? null;
  const isP1 = !!m?.player1 && m.player1.user_id === meId;
  const me: MatchPlayerView | null = m ? (isP1 ? m.player1 : m.player2?.user_id === meId ? m.player2 : null) : null;
  const opponent: MatchPlayerView | null = m ? (isP1 ? m.player2 : m.player1) : null;
  const participant = !!me;

  const startsIn = m ? new Date(m.tournament_starts_at).getTime() - now : 0;
  const deadlineIn = m?.deadline_at ? new Date(m.deadline_at).getTime() - now : null;

  const iWon = !!m?.winner_id && m.winner_id === meId;
  const iLost = !!m?.winner_id && participant && m.winner_id !== meId;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl }}
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
        <Button label="‹ Back" variant="ghost" onPress={() => navigation.goBack()} style={{ alignSelf: 'flex-start', minHeight: 36, paddingVertical: spacing.xs }} />

        {error && !m ? <Text style={{ color: colors.red }}>{error}</Text> : null}
        {!m ? <Text style={styles.meta}>Loading…</Text> : null}

        {m ? (
          <>
            {/* Header */}
            <View style={{ gap: spacing.xs }}>
              <Pressable onPress={() => navigation.navigate('Tournament', { tournamentId: m.tournament_id })}>
                <Text style={styles.meta}>{m.tournament_title} ›</Text>
              </Pressable>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                <Text style={styles.title}>
                  Round {m.match_round} · Match {m.match_number}
                </Text>
                <StatusBadge status={m.status} />
              </View>
            </View>

            {/* Face-off */}
            <FadeIn>
            <View style={[styles.card, styles.faceoff]}>
              <PlayerBlock p={participant ? me : m.player1} label={participant ? 'You' : 'Player 1'} highlight={participant} winner={m.winner_id} showUid={m.status !== 'pending' || participant} />
              <View style={styles.vsRow}>
                <View style={styles.vsLine} />
                <View style={styles.vsBadge}><Text style={styles.vs}>VS</Text></View>
                <View style={styles.vsLine} />
              </View>
              <PlayerBlock p={participant ? opponent : m.player2} label={participant ? 'Opponent' : 'Player 2'} winner={m.winner_id} showUid={m.status !== 'pending'} accent={colors.textMuted} />
            </View>
            </FadeIn>

            {/* Stage-specific content */}
            {m.status === 'pending' ? (
              !m.player1 || !m.player2 ? (
                <View style={styles.card}>
                  <Text style={styles.cardLabel}>Next opponent</Text>
                  <Text style={styles.meta}>Waiting for the previous round to finish. Your opponent will appear here, then you both agree a time to play.</Text>
                </View>
              ) : !m.schedule.round_opens_at || startsIn > 0 ? (
                <View style={styles.card}>
                  <Text style={styles.cardLabel}>Scheduling opens</Text>
                  <Text style={styles.big}>{startsIn > 0 ? countdown(startsIn) : 'Soon'}</Text>
                  <Text style={styles.meta2}>
                    {new Date(m.tournament_starts_at).toLocaleString()}. From then you and your opponent have 24 hours to agree a time and play.
                  </Text>
                </View>
              ) : participant && meId ? (
                <ScheduleCard matchId={m.id} meId={meId} opponent={opponent} schedule={m.schedule} onChanged={() => void load()} />
              ) : (
                <View style={styles.card}>
                  <Text style={styles.cardLabel}>Match time</Text>
                  <Text style={styles.big}>{m.schedule.scheduled_at ? new Date(m.schedule.scheduled_at).toLocaleString() : 'Being agreed'}</Text>
                  <Text style={styles.meta2}>The players agree a time between themselves. The room code appears when the match starts.</Text>
                </View>
              )
            ) : null}

            {m.status === 'active' || m.status === 'awaiting_results' ? (
              <>
                <View style={[styles.card, styles.roomCard]}>
                  <Eyebrow>Room code</Eyebrow>
                  <Text selectable style={styles.roomCode}>{m.room_code ?? 'Not yet'}</Text>
                  <Text style={styles.meta2}>Both players enter this code in the game to meet in the same room.</Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardLabel}>Result window</Text>
                  <Text style={[styles.big, deadlineIn !== null && deadlineIn < 5 * 60_000 && { color: colors.red }]}>
                    {deadlineIn === null ? 'n/a' : deadlineIn > 0 ? countdown(deadlineIn) : 'Closed'}
                  </Text>
                  <Text style={styles.meta2}>
                    Play now and submit your score screenshot before the window closes.
                    {deadlineIn !== null && deadlineIn <= 0 ? ' The system is settling this match.' : ''}
                  </Text>
                </View>

                {participant ? (
                  me?.pick ? (
                    <View style={styles.card}>
                      <Badge label={`Your pick: ${me.pick.toUpperCase()}`} tone="gold" />
                      <Text style={styles.meta}>
                        {opponent?.pick
                          ? 'Both results are in. Settling…'
                          : "Waiting for your opponent's result. If they don't submit before the window closes, the system settles it."}
                      </Text>
                    </View>
                  ) : (
                    <Button label="Submit result" onPress={() => navigation.navigate('SubmitResult', { matchId: m.id })} />
                  )
                ) : null}

                <Instructions />
              </>
            ) : null}

            {m.status === 'disputed' ? (
              <View style={[styles.card, { borderColor: colors.red }]}>
                <Badge label="Under review" tone="red" />
                <Text style={styles.meta}>
                  The results didn't agree, so an admin will review both screenshots and decide. Payouts are locked until then.
                </Text>
                {m.dispute_reason ? <Text style={styles.meta2}>Reason: {m.dispute_reason}</Text> : null}
                {me?.pick ? <Text style={styles.meta2}>Your pick: {me.pick}</Text> : null}
              </View>
            ) : null}

            {m.status === 'completed' ? (
              <View style={[styles.card, { borderColor: iWon ? colors.green : colors.border, alignItems: 'center' }]}>
                {iWon ? (
                  <>
                    <Text style={[styles.big, { color: colors.green }]}>You won</Text>
                    <Text style={styles.meta}>
                      {m.tournament_status === 'completed' ? 'You are the champion. Your payout is on its way to your MoMo.' : 'You advance to the next round. Check the bracket for your next opponent.'}
                    </Text>
                  </>
                ) : iLost ? (
                  <>
                    <Text style={[styles.big, { color: colors.textMuted }]}>Eliminated</Text>
                    <Text style={styles.meta}>{m.tournament_status === 'completed' ? 'Runner-up. Your payout is on its way to your MoMo.' : 'Better luck in the next cup.'}</Text>
                  </>
                ) : (
                  <Text style={styles.meta}>Winner: {[m.player1, m.player2].find((p) => p?.user_id === m.winner_id)?.username ?? 'n/a'}</Text>
                )}
                <Button label="View bracket" variant="secondary" onPress={() => navigation.navigate('Tournament', { tournamentId: m.tournament_id })} />
              </View>
            ) : null}

            <Text style={styles.meta2}>Auto-refreshes every {Config.matchPollMs / 1000}s · pull down to refresh now</Text>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function PlayerBlock({ p, label, highlight = false, winner, showUid, accent = colors.gold }: { p: MatchPlayerView | null; label: string; highlight?: boolean; winner: string | null; showUid: boolean; accent?: string }) {
  const won = !!p && winner === p.user_id;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={[styles.avatar, { borderColor: accent }]}>
        <Text style={{ color: accent, fontSize: typography.subheading, fontWeight: fontWeights.bold }}>{(p?.username ?? '?').slice(0, 1).toUpperCase()}</Text>
      </View>
    <View style={{ gap: 2, flex: 1 }}>
      <Eyebrow color={accent}>{label}</Eyebrow>
      {p ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Text style={[styles.name, highlight && { color: colors.gold }]}>{p.username}</Text>
            {p.seed ? <Badge label={`Seed ${p.seed}`} /> : null}
            {won ? <Badge label="Winner" tone="green" /> : null}
            {p.pick ? <Badge label={`picked ${p.pick}`} tone="gold" /> : null}
          </View>
          {showUid ? (
            <Text selectable style={styles.uid}>
              In-game ID: <Text style={{ color: colors.text, fontWeight: fontWeights.semibold }}>{p.game_uid}</Text>
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={[styles.name, { color: colors.textFaint }]}>TBD</Text>
      )}
    </View>
    </View>
  );
}

function StatusBadge({ status }: { status: MatchView['status'] }) {
  const map = {
    pending: { l: 'Upcoming', t: 'muted' },
    active: { l: 'LIVE', t: 'gold' },
    awaiting_results: { l: 'Awaiting result', t: 'gold' },
    disputed: { l: 'Disputed', t: 'red' },
    completed: { l: 'Completed', t: 'green' },
  } as const;
  return <Badge label={map[status].l} tone={map[status].t} />;
}

function Instructions() {
  const steps = [
    'Open the game and add your opponent using their in-game ID above.',
    'Create or join the friendly/room match with the room code.',
    'Play the match. Screenshot the final score screen. That is your proof.',
    'Come back here and submit your result before the window closes.',
    'Both results must agree. Disagreements go to an admin and nothing is paid until it is resolved.',
  ];
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>How it works</Text>
      {steps.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Text style={[styles.meta, { color: colors.gold, width: 16 }]}>{i + 1}.</Text>
          <Text style={[styles.meta, { flex: 1 }]}>{s}</Text>
        </View>
      ))}
    </View>
  );
}

function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const mi = Math.floor((s % 3600) / 60);
  const se = s % 60;
  if (d > 0) return `${d}d ${h}h ${mi}m`;
  if (h > 0) return `${h}h ${String(mi).padStart(2, '0')}m`;
  return `${mi}:${String(se).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold, letterSpacing: -0.3 },
  faceoff: { gap: spacing.md },
  roomCard: { borderColor: colors.gold, alignItems: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  vsBadge: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 2, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardLabel: { color: colors.textMuted, fontSize: typography.tiny, letterSpacing: 1, textTransform: 'uppercase' },
  name: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold },
  uid: { color: colors.textMuted, fontSize: typography.caption },
  big: { color: colors.gold, fontSize: typography.title, fontWeight: fontWeights.bold },
  roomCode: { color: colors.text, fontSize: 40, fontWeight: fontWeights.bold, letterSpacing: 8, fontVariant: ['tabular-nums'] },
  meta: { color: colors.textMuted, fontSize: typography.caption },
  meta2: { color: colors.textFaint, fontSize: typography.tiny },
  vsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.xs },
  vsLine: { flex: 1, height: 1, backgroundColor: colors.border },
  vs: { color: colors.textMuted, fontSize: typography.tiny, fontWeight: fontWeights.bold, letterSpacing: 2 },
});
