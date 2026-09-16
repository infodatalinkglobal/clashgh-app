import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiError, endpoints, type MatchView } from '../services/api';
import { compressForUpload, pickFromCamera, pickFromGallery, type PickedImage } from '../services/screenshots';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Screen, TextField } from '../components/ui';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'SubmitResult'>;
type Pick = 'won' | 'lost' | 'draw' | 'dispute';

const PICKS: { key: Pick; label: string; sub: string; tone: 'green' | 'muted' | 'gold' | 'red' }[] = [
  { key: 'won', label: 'I won', sub: 'Opponent must pick "I lost" to confirm', tone: 'green' },
  { key: 'lost', label: 'I lost', sub: 'Confirms your opponent as the winner', tone: 'muted' },
  { key: 'draw', label: 'Draw', sub: 'If both pick draw, an admin decides (replay or award)', tone: 'gold' },
  { key: 'dispute', label: 'Dispute', sub: 'Opponent cheated, did not show, or wrong room: admin review', tone: 'red' },
];

/**
 * Score Submit (Module 2E). Rule (agent.md §3): a result pick is ONLY
 * accepted with a screenshot attached: the API enforces it, the UI
 * makes it impossible to skip. Flow:
 *   1. pick screenshot (gallery / camera) → compressed ≤500KB preview
 *   2. choose won / lost / draw / dispute (+ reason for dispute)
 *   3. confirm → upload screenshot → POST /matches/:id/result
 * Upload happens only at confirm time so a change of mind costs no data.
 */
export function SubmitResultScreen({ navigation, route }: Props) {
  const { matchId } = route.params;
  const { profile } = useAuth();
  const [m, setM] = useState<MatchView | null>(null);
  const [img, setImg] = useState<PickedImage | null>(null);
  const [preview, setPreview] = useState<{ uri: string; bytes: number } | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'pick' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ status: string; winner_id?: string; message?: string } | null>(null);

  useEffect(() => {
    endpoints.getMatch(matchId).then(setM).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load match'));
  }, [matchId]);

  const meId = profile?.id ?? null;
  const opponent = m ? (m.player1?.user_id === meId ? m.player2 : m.player1) : null;

  const choose = async (source: 'gallery' | 'camera') => {
    setError(null);
    setBusy('pick');
    try {
      const picked = source === 'gallery' ? await pickFromGallery() : await pickFromCamera();
      if (!picked) return;
      // Compress now for the size preview; the base64 is re-generated at submit
      // (cheap) so we don't hold a large string in state on 2GB devices.
      const c = await compressForUpload(picked);
      setImg(picked);
      setPreview({ uri: `data:image/jpeg;base64,${c.base64}`, bytes: c.bytes });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that image');
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!img || !pick) return;
    if (pick === 'dispute' && reason.trim().length < 5) {
      setError('Tell the admin briefly what happened (at least 5 characters)');
      return;
    }
    setError(null);
    setBusy('submit');
    try {
      const c = await compressForUpload(img);
      const { url } = await endpoints.uploadScreenshot(c.base64, matchId);
      const res = await endpoints.submitResult(matchId, {
        pick,
        screenshot_url: url,
        ...(pick === 'dispute' ? { reason: reason.trim() } : {}),
      });
      setDone(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError(`${e.message}. Go back to the match room to see the latest state.`);
      else setError(e instanceof Error ? e.message : 'Submission failed. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    const won = done.status === 'completed' && done.winner_id === meId;
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <Badge label={done.status === 'completed' ? 'Match completed' : done.status === 'disputed' ? 'Sent for review' : 'Result recorded'} tone={done.status === 'disputed' ? 'red' : 'green'} />
          <Text style={styles.big}>
            {done.status === 'completed' ? (won ? 'You won' : 'Result confirmed') : done.status === 'disputed' ? 'Under admin review' : 'Waiting for opponent'}
          </Text>
          <Text style={[styles.meta, { textAlign: 'center' }]}>
            {done.status === 'completed'
              ? won
                ? 'Both results agree. You advance. Check the bracket for your next match.'
                : 'Both results agree. Match closed.'
              : done.status === 'disputed'
                ? done.message ?? 'An admin will review both screenshots. Payouts are locked until then.'
                : "Your pick and screenshot are saved. The match settles when your opponent submits, or on its own when the window closes."}
          </Text>
        </View>
        <Button label="Back to match room" onPress={() => navigation.navigate('Match', { matchId })} />
      </Screen>
    );
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <Button label="‹ Back" variant="ghost" onPress={() => navigation.goBack()} style={{ alignSelf: 'flex-start', minHeight: 36, paddingVertical: spacing.xs }} />
        <View style={{ gap: spacing.xs }}>
          <Text style={styles.title}>Submit result</Text>
          {m ? (
            <Text style={styles.meta}>
              {m.tournament_title} · Round {m.match_round} · vs {opponent?.username ?? 'n/a'}
            </Text>
          ) : null}
        </View>

        {error ? <Text style={{ color: colors.red, fontSize: typography.caption }}>{error}</Text> : null}

        {/* Step 1: screenshot */}
        <View style={styles.card}>
          <Text style={styles.step}>1 · Screenshot of the final score</Text>
          {preview ? (
            <>
              <Image source={{ uri: preview.uri }} style={styles.preview} resizeMode="contain" />
              <Text style={styles.meta2}>Compressed to {Math.round(preview.bytes / 1024)}KB for upload</Text>
            </>
          ) : (
            <Text style={styles.meta}>Required. The final score screen from the game. This is your proof; if the results disagree, an admin compares both screenshots.</Text>
          )}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button label={preview ? 'Change (gallery)' : 'Choose from gallery'} variant="secondary" busy={busy === 'pick'} onPress={() => void choose('gallery')} style={{ flex: 1 }} />
            <Button label="Camera" variant="secondary" busy={busy === 'pick'} onPress={() => void choose('camera')} style={{ flex: 1 }} />
          </View>
        </View>

        {/* Step 2: pick */}
        <View style={styles.card}>
          <Text style={styles.step}>2 · Your result</Text>
          {PICKS.map((p) => (
            <Pressable
              key={p.key}
              onPress={() => setPick(p.key)}
              style={({ pressed }) => [
                styles.option,
                pick === p.key && { borderColor: colors.gold, backgroundColor: 'rgba(245,179,1,0.08)' },
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.optionLabel, pick === p.key && { color: colors.gold }]}>{p.label}</Text>
                <Text style={styles.meta2}>{p.sub}</Text>
              </View>
              <View style={[styles.radio, pick === p.key && { borderColor: colors.gold, backgroundColor: colors.gold }]} />
            </Pressable>
          ))}
          {pick === 'dispute' ? (
            <TextField label="What happened?" value={reason} onChangeText={setReason} placeholder="e.g. Opponent never joined the room" autoCapitalize="sentences" hint="Shown to the admin reviewing the match" />
          ) : null}
        </View>

        <Text style={styles.meta2}>
          Once submitted, your pick is final. Payouts only happen when both results agree or an admin resolves the match. False claims lead to a ban.
        </Text>
        <Button
          label={busy === 'submit' ? 'Uploading…' : 'Confirm & submit'}
          busy={busy === 'submit'}
          disabled={!img || !pick}
          onPress={() => void submit()}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: typography.title, fontWeight: fontWeights.bold },
  big: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  step: { color: colors.text, fontSize: typography.subheading, fontWeight: fontWeights.semibold },
  meta: { color: colors.textMuted, fontSize: typography.caption },
  meta2: { color: colors.textFaint, fontSize: typography.tiny },
  preview: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: colors.bg },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  optionLabel: { color: colors.text, fontSize: typography.body, fontWeight: fontWeights.semibold },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.textFaint },
});
