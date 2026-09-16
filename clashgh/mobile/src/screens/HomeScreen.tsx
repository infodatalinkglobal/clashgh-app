import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  endpoints,
  pesewasToGhs,
  relativeTime,
  type GameType,
  type RegistrationView,
  type Tournament,
  type TournamentStatus,
} from '../services/api';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Countdown, FadeIn, GameTile, LiveDot, Screen, Skeleton } from '../components/ui';
import { GAMES, colors, fontWeights, radius, spacing, typography } from '../theme';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;


const FILTERS: { key: GameType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'efootball', label: 'eFootball' },
  { key: 'fc_mobile', label: 'FC Mobile' },
  { key: 'codm', label: 'CODM' },
  { key: 'dls', label: 'DLS' },
];

const STATUS_TONE: Record<TournamentStatus, 'green' | 'muted' | 'red' | 'gold'> = {
  open: 'green',
  full: 'muted',
  in_progress: 'gold',
  completed: 'muted',
  cancelled: 'red',
};

/**
 * Home & Lobby (Module 2B).
 * Browse tournaments, filter by game, entry-fee display, join button.
 * "Last updated" label + refresh on screen focus (agent.md §14).
 */
export function HomeScreen({ navigation }: Props) {
  const { profile } = useAuth();
  const [game, setGame] = useState<GameType | 'all'>('all');
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [registrations, setRegistrations] = useState<Record<string, RegistrationView | null>>({});
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (gameFilter: GameType | 'all') => {
      try {
        const { tournaments: list } = await endpoints.listTournaments({
          game: gameFilter === 'all' ? undefined : gameFilter,
          limit: 25,
        });
        setTournaments(list);
        // My registration state per visible tournament (open / in-progress only).
        const relevant = list.filter((t) => t.status === 'open' || t.status === 'in_progress');
        const entries = await Promise.all(
          relevant.map(async (t) => {
            try {
              const { registration } = await endpoints.myRegistration(t.id);
              return [t.id, registration] as const;
            } catch {
              return [t.id, null] as const;
            }
          }),
        );
        setRegistrations((prev) => {
          const next = { ...prev };
          for (const [id, reg] of entries) next[id] = reg;
          return next;
        });
        setUpdatedAt(new Date());
      } catch {
        // keep last data
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  // Refresh on focus (agent.md §14) + on mount.
  useFocusEffect(
    useCallback(() => {
      void load(game);
    }, [load, game]),
  );

  const onFilter = (g: GameType | 'all') => {
    setGame(g);
    setLoading(true);
    void load(g);
  };

  const renderCard = ({ item: t, index }: { item: Tournament; index: number }) => {
    const reg = registrations[t.id];
    const g = GAMES[t.game];
    const paid = t.paid_count;
    const fillPct = Math.min(100, Math.round((paid / t.max_players) * 100));
    const live = t.status === 'in_progress';
    const spotsText =
      t.status === 'cancelled' ? 'Cancelled'
        : t.spots_left > 0 ? `${t.spots_left} spot${t.spots_left === 1 ? '' : 's'} left`
          : 'Lobby full';
    const topPrize = pesewasToGhs(t.prize_pool_pesewas ?? t.projection_if_full.first_prize_pesewas);
    return (
      <FadeIn delay={Math.min(index, 6) * 30}>
        <Pressable
          onPress={() => navigation.navigate('Tournament', { tournamentId: t.id })}
          style={({ pressed }) => [styles.card, { borderLeftColor: g.accent }, pressed && { backgroundColor: colors.surfaceAlt }]}
        >
          <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
            <GameTile code={g.code} accent={g.accent} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text style={styles.gameLabel}>{g.label}</Text>
                {live ? (
                  <View style={styles.livePill}><LiveDot size={6} /><Text style={styles.liveText}>Live</Text></View>
                ) : t.status !== 'open' ? (
                  <Badge label={t.status.replace('_', ' ')} tone={STATUS_TONE[t.status]} />
                ) : null}
              </View>
              <Text style={styles.title} numberOfLines={2}>{t.title}</Text>
              <Text style={styles.hostLine}>{t.host ? `Hosted by @${t.host.username ?? 'host'}` : 'Official ClashGH tournament'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.prize}>{topPrize}</Text>
              <Text style={styles.meta}>top prize</Text>
            </View>
          </View>

          <View style={{ gap: spacing.xs }}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${fillPct}%`, backgroundColor: g.accent }]} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.meta}>{paid}/{t.max_players} players · {spotsText}</Text>
              {t.status === 'open' ? (
                <Countdown to={t.closes_at} prefix="Closes in " style={styles.meta} />
              ) : (
                <Text style={styles.meta}>Starts {relativeTime(t.starts_at)}</Text>
              )}
            </View>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.entry}>Entry {pesewasToGhs(t.entry_fee_pesewas)}</Text>
            {t.status === 'cancelled' ? (
              <Badge label="Cancelled" tone="red" />
            ) : reg?.payment_status === 'paid' ? (
              <Badge label="You're in" tone="green" />
            ) : reg?.payment_status === 'pending' ? (
              <Button label="Finish payment" onPress={() => navigation.navigate('Join', { tournamentId: t.id, resumeReference: reg.payment_reference, resumeDeadline: reg.payment_deadline })} style={styles.cta} />
            ) : t.can_join ? (
              <Button label="Join" onPress={() => navigation.navigate('Join', { tournamentId: t.id })} style={styles.cta} />
            ) : t.status === 'full' || t.status === 'in_progress' || t.status === 'completed' ? (
              <Button label={live ? 'Watch' : 'Bracket'} variant="secondary" onPress={() => navigation.navigate('Tournament', { tournamentId: t.id })} style={styles.cta} />
            ) : (
              <Badge label="Closed" tone="muted" />
            )}
          </View>
        </Pressable>
      </FadeIn>
    );
  };

  const liveCount = tournaments.filter((t) => t.status === 'in_progress').length;
  const openCount = tournaments.filter((t) => t.status === 'open').length;

  return (
    <Screen style={{ padding: 0, gap: 0 }}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>Clash<Text style={{ color: colors.gold }}>GH</Text></Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <Pressable onPress={() => navigation.navigate('Wallet')} hitSlop={8} style={[styles.iconBtn, { width: undefined, paddingHorizontal: spacing.md }]}>
            <Text style={{ color: colors.text, fontSize: typography.caption, fontWeight: fontWeights.semibold }}>Wallet</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Inbox')} hitSlop={8} style={[styles.iconBtn, { width: undefined, paddingHorizontal: spacing.md }]} accessibilityLabel="Notifications">
            <Text style={{ color: colors.text, fontSize: typography.caption, fontWeight: fontWeights.semibold }}>Inbox</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Me')} hitSlop={8} style={styles.iconBtn}>
            <Text style={{ color: colors.gold, fontWeight: fontWeights.bold }}>{(profile?.username ?? '?').slice(0, 1).toUpperCase()}</Text>
          </Pressable>
        </View>
      </View>
      <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.sm }}>
        <Text style={styles.h1}>Tournaments</Text>
        <Text style={styles.sub}>
          {liveCount > 0 ? `${liveCount} live · ` : ''}{openCount} open for registration
          {updatedAt ? ` · updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
        </Text>
      </View>

      <View style={{ paddingHorizontal: spacing.xl }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}>
          {FILTERS.map((f) => (
            <FilterChip key={f.key} label={f.label} active={game === f.key} accent={f.key === 'all' ? colors.gold : GAMES[f.key].accent} onPress={() => onFilter(f.key)} />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={tournaments}
        keyExtractor={(t) => t.id}
        renderItem={renderCard}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(game);
            }}
            tintColor={colors.gold}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={{ gap: spacing.md }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.card}>
                  <View style={{ flexDirection: 'row', gap: spacing.md }}>
                    <Skeleton height={44} width={44} />
                    <View style={{ flex: 1, gap: spacing.sm }}>
                      <Skeleton height={14} width="30%" />
                      <Skeleton height={18} width="70%" />
                    </View>
                  </View>
                  <Skeleton height={4} />
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>No tournaments in this list right now.</Text>
          )
        }
      />
    </Screen>
  );
}

function FilterChip({ label, active, accent, onPress }: { label: string; active: boolean; accent: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: active ? colors.text : colors.surface,
        borderColor: active ? colors.text : colors.border,
        borderWidth: 1,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ color: active ? colors.bg : colors.textMuted, fontSize: typography.caption, fontWeight: fontWeights.semibold }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  brand: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold, letterSpacing: -0.3 },
  iconBtn: { height: 34, width: 34, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  h1: { color: colors.text, fontSize: typography.title, fontWeight: fontWeights.bold, letterSpacing: -0.5 },
  sub: { color: colors.textMuted, fontSize: typography.caption, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderLeftWidth: 3, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  gameLabel: { color: colors.textMuted, fontSize: typography.tiny, fontWeight: fontWeights.semibold, letterSpacing: 0.6, textTransform: 'uppercase' },
  livePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(229,72,77,0.12)', borderRadius: radius.pill, paddingRight: spacing.sm, paddingVertical: 1 },
  liveText: { color: colors.red, fontSize: typography.tiny, fontWeight: fontWeights.semibold },
  title: { color: colors.text, fontSize: typography.subheading, fontWeight: fontWeights.semibold, lineHeight: 21 },
  hostLine: { color: colors.textFaint, fontSize: typography.tiny },
  prize: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold, fontVariant: ['tabular-nums'] },
  entry: { color: colors.textMuted, fontSize: typography.caption, fontWeight: fontWeights.medium },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  meta: { color: colors.textFaint, fontSize: typography.tiny },
  cta: { minHeight: 36, paddingVertical: spacing.xs, paddingHorizontal: spacing.lg },
  empty: { color: colors.textMuted, fontSize: typography.body, textAlign: 'center', marginTop: spacing.xxl },
});
