import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { endpoints, pesewasToGhs, type TransactionRow, type WalletTotals } from '../services/api';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Eyebrow, FadeIn, Screen } from '../components/ui';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import { providerLabel, toLocalDisplay } from '../utils/phone';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePageTitle } from '../utils/pageTitle';

type Props = NativeStackScreenProps<RootStackParamList, 'Wallet'>;

const PAGE = 30;

const TYPE_META: Record<TransactionRow['type'], { label: string; sign: '+' | '−'; color: string }> = {
  entry_fee: { label: 'Entry fee', sign: '−', color: colors.text },
  payout: { label: 'Winnings', sign: '+', color: colors.green },
  refund: { label: 'Refund', sign: '+', color: colors.blue },
  platform_fee: { label: 'Platform fee', sign: '−', color: colors.textMuted },
};

/**
 * Wallet (Module 2F). READ-ONLY: there is no in-app balance (agent.md §3).
 * Every row is money that moved between the player's MoMo and Paystack,
 * fees paid in, winnings and refunds paid out: with the payout status so
 * a player can see "on its way" vs "sent" vs "failed, retrying".
 * Cached in memory across focus; last page kept when offline.
 */
export function WalletScreen({ navigation }: Props) {
  usePageTitle('Wallet');
  const { profile } = useAuth();
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [totals, setTotals] = useState<WalletTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (offset = 0) => {
    try {
      const res = await endpoints.myTransactions({ limit: PAGE, offset });
      setRows((prev) => (offset === 0 ? res.transactions : [...prev, ...res.transactions]));
      setTotals(res.totals);
      setHasMore(res.transactions.length === PAGE);
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(0);
    }, [load]),
  );

  const net = totals ? totals.winnings_pesewas + totals.refunds_pesewas - totals.fees_paid_pesewas : 0;

  return (
    <Screen style={{ padding: 0, gap: 0 }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xxl, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(0); }} tintColor={colors.gold} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (hasMore && !loading) void load(rows.length); }}
        ListHeaderComponent={
          <View style={{ gap: spacing.lg, marginBottom: spacing.md }}>
            <Button label="‹ Back" variant="ghost" onPress={() => navigation.goBack()} style={{ alignSelf: 'flex-start', minHeight: 36, paddingVertical: spacing.xs }} />
            <View>
              <Text style={styles.title}>Wallet</Text>
              <Text style={styles.meta2}>{updatedAt ? `Last updated ${updatedAt.toLocaleTimeString()}` : 'Loading…'}</Text>
            </View>

            <FadeIn>
            <View style={styles.hero}>
              <Eyebrow>Net winnings</Eyebrow>
              <Text style={[styles.big, { color: net >= 0 ? colors.green : colors.text }]}>
                {net < 0 ? '−' : ''}{pesewasToGhs(Math.abs(net))}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs }}>
                <Stat label="Won" value={pesewasToGhs(totals?.winnings_pesewas ?? 0)} color={colors.green} />
                <Stat label="Fees paid" value={pesewasToGhs(totals?.fees_paid_pesewas ?? 0)} />
                <Stat label="Refunded" value={pesewasToGhs(totals?.refunds_pesewas ?? 0)} color={colors.blue} />
              </View>
              {totals && totals.pending_out_pesewas > 0 ? (
                <Badge label={`${pesewasToGhs(totals.pending_out_pesewas)} on its way to your MoMo`} tone="gold" />
              ) : null}
              <Text style={styles.meta2}>
                No balance is held in the app. Winnings and refunds go straight to
                {profile?.phone ? ` ${toLocalDisplay(profile.phone)}` : ' your MoMo'}
                {profile?.momo_provider ? ` (${providerLabel(profile.momo_provider)})` : ''}.
              </Text>
            </View>
            </FadeIn>

            {error ? <Text style={{ color: colors.red, fontSize: typography.caption }}>{error}</Text> : null}
            <Text style={styles.section}>History</Text>
          </View>
        }
        renderItem={({ item }) => <TxRow tx={item} onPress={item.tournament_id ? () => navigation.navigate('Tournament', { tournamentId: item.tournament_id as string }) : undefined} />}
        ListEmptyComponent={
          <Text style={styles.empty}>{loading ? 'Loading…' : 'No transactions yet. Join a tournament to get started.'}</Text>
        }
        ListFooterComponent={hasMore ? <Text style={[styles.meta2, { textAlign: 'center', marginTop: spacing.md }]}>Loading more…</Text> : null}
      />
    </Screen>
  );
}

function TxRow({ tx, onPress }: { tx: TransactionRow; onPress?: () => void }) {
  const meta = TYPE_META[tx.type];
  const failed = tx.status === 'failed';
  const pending = tx.status === 'pending';
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
      <View style={[styles.dot, { backgroundColor: failed ? colors.red : pending ? colors.gold : meta.color }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{meta.label}{tx.tournament_title ? ` · ${tx.tournament_title}` : ''}</Text>
        <Text style={styles.meta2}>
          {new Date(tx.created_at).toLocaleString()}
          {pending && tx.type !== 'entry_fee' ? ' · sending to MoMo…' : ''}
          {failed ? (tx.attempts >= 3 ? ' · failed, support notified' : ` · retrying${tx.next_retry_at ? ' soon' : ''}`) : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={[styles.amount, { color: failed ? colors.textFaint : meta.color }, failed && { textDecorationLine: 'line-through' }]}>
          {meta.sign}{pesewasToGhs(tx.amount_pesewas)}
        </Text>
        {tx.status !== 'success' ? <Badge label={tx.status} tone={failed ? 'red' : 'gold'} /> : null}
      </View>
    </Pressable>
  );
}

function Stat({ label, value, color = colors.text }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.meta2}>{label}</Text>
      <Text style={{ color, fontSize: typography.body, fontWeight: fontWeights.semibold }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: typography.title, fontWeight: fontWeights.bold, letterSpacing: -0.5 },
  section: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.semibold },
  hero: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.sm },
  cardLabel: { color: colors.textMuted, fontSize: typography.tiny, letterSpacing: 1, textTransform: 'uppercase' },
  big: { fontSize: 36, fontWeight: fontWeights.bold, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowTitle: { color: colors.text, fontSize: typography.caption, fontWeight: fontWeights.medium },
  amount: { fontSize: typography.body, fontWeight: fontWeights.bold, fontVariant: ['tabular-nums'] },
  meta2: { color: colors.textFaint, fontSize: typography.tiny },
  empty: { color: colors.textMuted, fontSize: typography.body, textAlign: 'center', marginTop: spacing.xl },
});
