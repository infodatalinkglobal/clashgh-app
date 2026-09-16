import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { endpoints, type NotificationRow } from '../services/api';
import { FadeIn, Screen } from '../components/ui';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Inbox'>;

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** In-app inbox. Mirrors the push channel so the web build (no push) still
 *  sees room codes, results and payout confirmations. Tapping deep-links to
 *  the match/tournament referenced in the payload. */
export function InboxScreen({ navigation }: Props) {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await endpoints.myNotifications(50);
      setRows(res.notifications);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notifications');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = (n: NotificationRow) => {
    const p = n.payload as { match_id?: string; tournament_id?: string };
    if (p.match_id) navigation.navigate('Match', { matchId: p.match_id });
    else if (p.tournament_id) navigation.navigate('Tournament', { tournamentId: p.tournament_id });
  };

  return (
    <Screen style={{ padding: 0, gap: 0 }}>
      <FlatList
        data={rows}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.gold} />}
        ListHeaderComponent={
          <Text style={styles.h1}>Notifications</Text>
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{error ?? 'No messages yet. Room codes, results and payouts will show up here.'}</Text>
            </View>
          )
        }
        renderItem={({ item, index }) => {
          const linked = Boolean((item.payload as { match_id?: string; tournament_id?: string }).match_id || (item.payload as { tournament_id?: string }).tournament_id);
          return (
            <FadeIn delay={Math.min(index, 8) * 50}>
            <Pressable onPress={() => open(item)} disabled={!linked} style={({ pressed }) => [styles.card, pressed && linked && { opacity: 0.8 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
              </View>
              {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
              {linked ? <Text style={styles.link}>Open</Text> : null}
            </Pressable>
            </FadeIn>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: typography.title, fontWeight: fontWeights.bold, letterSpacing: -0.5, marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs, borderWidth: 1, borderColor: colors.border, },
  title: { flex: 1, color: colors.text, fontSize: typography.body, fontWeight: fontWeights.semibold },
  time: { color: colors.textFaint, fontSize: typography.tiny },
  body: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 18 },
  link: { color: colors.gold, fontSize: typography.tiny, fontWeight: fontWeights.semibold, marginTop: spacing.xs },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: colors.textMuted, textAlign: 'center', fontSize: typography.caption },
});
