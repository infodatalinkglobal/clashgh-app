import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BracketMatch, BracketPlayer, BracketView } from '../services/api';
import { colors, fontWeights, radius, spacing, typography } from '../theme';

/**
 * Single-elimination bracket view — hand-rolled (agent.md §4: no heavy
 * deps, APK < 15MB, must render on 2GB Tecno/Infinix devices).
 *
 * Layout: one column per round, scrolled horizontally. Each match card is
 * placed in a slot of height `slotHeight × 2^(round-1)` so it sits
 * vertically centred between the two matches that feed it.
 */

const MATCH_H = 76;
const MATCH_W = 168;
const SLOT_GAP = 12;

const ROUND_LABEL = (round: number, total: number) => {
  const remaining = total - round;
  if (remaining === 0) return 'Final';
  if (remaining === 1) return 'Semi-finals';
  if (remaining === 2) return 'Quarter-finals';
  return `Round ${round}`;
};

const STATUS_LABEL: Record<BracketMatch['status'], string> = {
  pending: 'Upcoming',
  active: 'LIVE',
  awaiting_results: 'Awaiting result',
  disputed: 'Disputed',
  completed: 'Done',
};

export function Bracket({
  bracket,
  meId,
  onPressMatch,
}: {
  bracket: BracketView;
  meId: string | null;
  onPressMatch?: (match: BracketMatch) => void;
}) {
  const totalRounds = bracket.rounds.length;
  if (!bracket.bracket_generated || totalRounds === 0) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: spacing.xl }}>
      {bracket.rounds.map(({ round, matches }) => {
        const slotH = (MATCH_H + SLOT_GAP) * 2 ** (round - 1);
        return (
          <View key={round} style={{ width: MATCH_W + spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
              <View style={{ width: 3, height: 10, borderRadius: 2, backgroundColor: round === totalRounds ? colors.gold : colors.border }} />
              <Text style={styles.roundLabel}>{ROUND_LABEL(round, totalRounds)}</Text>
            </View>
            {matches.map((m) => (
              <View key={m.id} style={{ height: slotH, justifyContent: 'center' }}>
                <MatchCard match={m} meId={meId} onPress={onPressMatch} isFinal={round === totalRounds} />
              </View>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

function MatchCard({
  match,
  meId,
  onPress,
  isFinal,
}: {
  match: BracketMatch;
  meId: string | null;
  onPress?: (m: BracketMatch) => void;
  isFinal: boolean;
}) {
  const mine = !!meId && (match.player1?.id === meId || match.player2?.id === meId);
  const live = match.status === 'active' || match.status === 'awaiting_results';
  const borderColor = live ? colors.gold : match.status === 'disputed' ? colors.red : mine ? colors.borderBright : colors.border;
  return (
    <Pressable
      onPress={onPress && mine ? () => onPress(match) : undefined}
      disabled={!(onPress && mine)}
      style={({ pressed }) => [
        styles.card,
        { borderColor, opacity: pressed ? 0.85 : 1 },
        live && styles.liveGlow,
        isFinal && { backgroundColor: colors.surfaceAlt },
      ]}
    >
      {live ? <View style={styles.liveBar} /> : null}
      <PlayerRow p={match.player1} winner={match.winner} meId={meId} />
      <View style={styles.divider} />
      <PlayerRow p={match.player2} winner={match.winner} meId={meId} />
      <View style={styles.statusPill}>
        <Text style={[styles.statusText, live && { color: colors.gold }, match.status === 'disputed' && { color: colors.red }]}>
          {STATUS_LABEL[match.status]}
          {mine && match.status === 'pending' ? ' · you' : ''}
        </Text>
      </View>
    </Pressable>
  );
}

function PlayerRow({ p, winner, meId }: { p: BracketPlayer | null; winner: string | null; meId: string | null }) {
  if (!p) return <Text style={[styles.player, { color: colors.textFaint }]}>TBD</Text>;
  const won = winner === p.id;
  const lost = !!winner && !won;
  const me = p.id === meId;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      {p.seed ? <Text style={styles.seed}>{p.seed}</Text> : null}
      <Text
        numberOfLines={1}
        style={[
          styles.player,
          me && { color: colors.gold, fontWeight: fontWeights.semibold },
          won && { fontWeight: fontWeights.bold },
          lost && { color: colors.textFaint, textDecorationLine: 'line-through' },
        ]}
      >
        {p.username}
        {me ? ' (you)' : ''}
      </Text>
      {won ? <Text style={{ color: colors.green, fontSize: typography.tiny }}>✓</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  roundLabel: {
    color: colors.textMuted,
    fontSize: typography.tiny,
    fontWeight: fontWeights.semibold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  card: {
    width: MATCH_W,
    height: MATCH_H,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'visible',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    gap: 4,
  },
  divider: { height: 1, backgroundColor: colors.border },
  liveGlow: {},
  liveBar: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: colors.gold },
  player: { color: colors.text, fontSize: typography.caption, flexShrink: 1 },
  seed: {
    color: colors.textFaint,
    fontSize: 9,
    width: 12,
    textAlign: 'center',
  },
  statusPill: { position: 'absolute', top: -8, right: 8, backgroundColor: colors.bg, paddingHorizontal: 4 },
  statusText: { color: colors.textFaint, fontSize: 9, fontWeight: fontWeights.semibold, letterSpacing: 0.5 },
});
