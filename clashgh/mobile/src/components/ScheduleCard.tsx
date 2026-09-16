import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, endpoints, type MatchSchedule, type MatchPlayerView } from '../services/api';
import { Badge, Button } from './ui';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import { toLocalDisplay } from '../utils/phone';

/**
 * Scheduling card for a pending match (both players known).
 *
 * States, from the viewer's side:
 *   - no proposal            : pick a time and propose
 *   - my proposal pending    : waiting; can change it
 *   - their proposal pending : accept, or suggest another time
 *   - agreed                 : show time; one "ask to move" allowed
 * All times are shown in the device's local zone (Ghana = GMT).
 */
export function ScheduleCard({
  matchId, meId, opponent, schedule, onChanged,
}: {
  matchId: string;
  meId: string;
  opponent: MatchPlayerView | null;
  schedule: MatchSchedule;
  onChanged: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closes = schedule.window_closes_at ? new Date(schedule.window_closes_at) : null;
  const proposed = schedule.proposed_at ? new Date(schedule.proposed_at) : null;
  const agreed = schedule.scheduled_at ? new Date(schedule.scheduled_at) : null;
  const mine = schedule.proposed_by === meId;
  const oppName = opponent?.username ?? 'your opponent';
  const canPropose = !agreed || schedule.reschedules_left > 0;

  const act = async (body: Parameters<typeof endpoints.scheduleMatch>[1]) => {
    setBusy(true);
    setError(null);
    try {
      await endpoints.scheduleMatch(matchId, body);
      setPicking(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update the schedule. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={styles.label}>Match time</Text>
        {agreed ? <Badge label="Agreed" tone="green" /> : proposed ? <Badge label={mine ? 'Waiting for reply' : 'Reply needed'} tone="gold" /> : <Badge label="Not set" />}
      </View>

      {agreed ? (
        <>
          <Text style={styles.big}>{fmt(agreed)}</Text>
          <Text style={styles.meta}>The room code appears here at that time. Be in the game a few minutes early.</Text>
        </>
      ) : null}

      {proposed ? (
        <View style={styles.proposal}>
          <Text style={styles.meta}>{mine ? 'You proposed' : `${oppName} proposed`}{agreed ? ' to move the match to' : ''}</Text>
          <Text style={styles.big}>{fmt(proposed)}</Text>
          <Text style={styles.meta2}>
            {mine
              ? `If ${oppName} does not reply, the match starts at this time.`
              : `If you do not reply, the match starts at this time.`}
          </Text>
        </View>
      ) : null}

      {!agreed && !proposed ? (
        <Text style={styles.meta}>
          Agree a time with {oppName}. If nobody proposes, the match starts automatically when the window closes.
        </Text>
      ) : null}

      {closes ? <Text style={styles.meta2}>Window closes {fmt(closes)}.{agreed ? ` Moves left: ${schedule.reschedules_left}.` : ''}</Text> : null}

      {opponent?.contact_phone ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text style={styles.meta}>{oppName}: {toLocalDisplay(opponent.contact_phone)}</Text>
          <Button label="WhatsApp" variant="secondary" onPress={() => void Linking.openURL(`https://wa.me/${opponent.contact_phone!.replace('+', '')}`)} style={styles.smallBtn} />
          <Button label="Call" variant="secondary" onPress={() => void Linking.openURL(`tel:${opponent.contact_phone}`)} style={styles.smallBtn} />
        </View>
      ) : (
        <Text style={styles.meta2}>Add a contact number in Account if you want opponents to reach you on WhatsApp.</Text>
      )}

      {error ? <Text style={{ color: colors.red, fontSize: typography.caption }}>{error}</Text> : null}

      {!picking ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {proposed && !mine ? <Button label="Accept" busy={busy} onPress={() => void act({ action: 'accept' })} style={{ flex: 1 }} /> : null}
          {canPropose ? (
            <Button
              label={proposed ? (mine ? 'Change my time' : 'Suggest another time') : agreed ? 'Ask to move' : 'Propose a time'}
              variant={proposed && !mine ? 'secondary' : 'primary'}
              onPress={() => setPicking(true)}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
      ) : (
        <TimePicker
          earliest={new Date(Math.max(Date.now() + 15 * 60_000, schedule.round_opens_at ? new Date(schedule.round_opens_at).getTime() : 0))}
          latest={closes ?? new Date(Date.now() + 24 * 3600_000)}
          busy={busy}
          onCancel={() => setPicking(false)}
          onConfirm={(d) => void act({ action: 'propose', at: d.toISOString() })}
        />
      )}
    </View>
  );
}

/** Day chips + hour + quarter-hour, clamped to [earliest, latest]. No native picker dependency. */
function TimePicker({ earliest, latest, busy, onCancel, onConfirm }: { earliest: Date; latest: Date; busy: boolean; onCancel: () => void; onConfirm: (d: Date) => void }) {
  const days = useMemo(() => {
    const out: Date[] = [];
    const d = new Date(earliest);
    d.setHours(0, 0, 0, 0);
    while (d.getTime() <= latest.getTime()) {
      out.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [earliest, latest]);

  const [day, setDay] = useState(0);
  const [hour, setHour] = useState(Math.min(23, earliest.getHours() + 1));
  const [minute, setMinute] = useState(0);

  const chosen = new Date(days[day] ?? earliest);
  chosen.setHours(hour, minute, 0, 0);
  const valid = chosen.getTime() >= earliest.getTime() && chosen.getTime() <= latest.getTime();

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.meta}>Day</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
        {days.map((d, i) => (
          <Chip key={d.toISOString()} label={d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} active={i === day} onPress={() => setDay(i)} />
        ))}
      </ScrollView>
      <Text style={styles.meta}>Hour</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
        {Array.from({ length: 24 }, (_, h) => h).map((h) => (
          <Chip key={h} label={`${String(h).padStart(2, '0')}:00`} active={h === hour} onPress={() => setHour(h)} />
        ))}
      </ScrollView>
      <Text style={styles.meta}>Minute</Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
        {[0, 15, 30, 45].map((m) => (
          <Chip key={m} label={`:${String(m).padStart(2, '0')}`} active={m === minute} onPress={() => setMinute(m)} />
        ))}
      </View>
      <Text style={[styles.meta, !valid && { color: colors.red }]}>
        {valid ? `Propose ${fmt(chosen)}` : `Pick a time between ${fmt(earliest)} and ${fmt(latest)}`}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button label="Send proposal" busy={busy} disabled={!valid} onPress={() => onConfirm(chosen)} style={{ flex: 2 }} />
      </View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

function fmt(d: Date) {
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.gold, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: typography.tiny, letterSpacing: 1, textTransform: 'uppercase' },
  big: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold, fontVariant: ['tabular-nums'] },
  meta: { color: colors.textMuted, fontSize: typography.caption },
  meta2: { color: colors.textFaint, fontSize: typography.tiny },
  proposal: { borderLeftWidth: 3, borderLeftColor: colors.gold, paddingLeft: spacing.md, gap: 2 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.text, fontSize: typography.caption, fontWeight: fontWeights.semibold, fontVariant: ['tabular-nums'] },
  smallBtn: { minHeight: 34, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
});
