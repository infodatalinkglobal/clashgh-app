import React, { useCallback, useState } from 'react';
import {
  FlatList,
  ImageBackground,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
import { Badge, Button, Countdown, Eyebrow, FadeIn, LiveDot, Screen, Skeleton } from '../components/ui';
import { GAMES, HERO_ART, colors, fontWeights, radius, spacing, typography } from '../theme';
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
      <FadeIn delay={Math.min(index, 6) * 60}>
        <Pressable
          onPress={() => navigation.navigate('Tournament', { tournamentId: t.id })}
          style={({ pressed }) => [styles.card, { borderColor: pressed ? g.accent : colors.border }, pressed && { transform: [{ scale: 0.99 }] }]}
        >
          <ImageBackground source={g.art} style={styles.cardArt} imageStyle={{ borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}>
            <LinearGradient colors={['rgba(7,9,13,0.05)', 'rgba(7,9,13,0.55)', colors.surface]} locations={[0, 0.6, 1]} style={StyleSheet.absoluteFill} />
            <View style={styles.cardArtTop}>
              <View style={[styles.gamePill, { borderColor: g.accent }]}>
                <Text style={{ color: g.accent, fontSize: typography.tiny, fontWeight: fontWeights.bold, letterSpacing: 1 }}>{g.label.toUpperCase()}</Text>
              </View>
              {live ? (
                <View style={styles.livePill}><LiveDot size={6} /><Text style={styles.liveText}>LIVE</Text></View>
              ) : (
                <Badge label={t.status.replace('_', ' ')} tone={STATUS_TONE[t.status]} />
              )}
            </View>
            <View style={{ padding: spacing.lg, paddingBottom: 0 }}>
              <Text style={styles.title} numberOfLines={2}>{t.title}</Text>
            </View>
          </ImageBackground>

          <View style={{ padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <Eyebrow>Top prize</Eyebrow>
                <Text style={styles.prize}>{topPrize}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Eyebrow>Entry</Eyebrow>
                <Text style={styles.entry}>{pesewasToGhs(t.entry_fee_pesewas)}</Text>
              </View>
            </View>

            <View style={{ gap: spacing.xs }}>
              <View style={styles.track}>
                <LinearGradient colors={[g.accent, colors.gold]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fill, { width: `${fillPct}%` }]} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.meta}>{paid}/{t.max_players} players · {spotsText}</Text>
                {t.status === 'open' ? (
                  <Countdown to={t.closes_at} prefix="Closes in " style={[styles.meta, { color: colors.cyan }]} />
                ) : (
                  <Text style={styles.meta}>Starts {relativeTime(t.starts_at)}</Text>
                )}
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              {t.status === 'cancelled' ? (
                <Badge label="Cancelled" tone="red" />
              ) : reg?.payment_status === 'paid' ? (
                <Badge label="You're in ✓" tone="green" />
              ) : reg?.payment_status === 'pending' ? (
                <Button label="Finish payment →" onPress={() => navigation.navigate('Join', { tournamentId: t.id, resumeReference: reg.payment_reference, resumeDeadline: reg.payment_deadline })} />
              ) : t.can_join ? (
                <Button label="Join now" onPress={() => navigation.navigate('Join', { tournamentId: t.id })} />
              ) : t.status === 'full' || t.status === 'in_progress' || t.status === 'completed' ? (
                <Button label={live ? 'Watch live →' : 'View bracket →'} variant="secondary" onPress={() => navigation.navigate('Tournament', { tournamentId: t.id })} />
              ) : (
                <Badge label="Closed" tone="muted" />
              )}
            </View>
          </View>
        </Pressable>
      </FadeIn>
    );
  };

  const liveCount = tournaments.filter((t) => t.status === 'in_progress').length;
  const openCount = tournaments.filter((t) => t.status === 'open').length;

  return (
    <Screen style={{ padding: 0, gap: 0 }}>
      <ImageBackground source={HERO_ART} style={styles.hero} imageStyle={{ opacity: 0.9 }}>
        <LinearGradient colors={['rgba(7,9,13,0.15)', 'rgba(7,9,13,0.6)', colors.bg]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.topBar}>
          <Text style={styles.brand}>CLASH<Text style={{ color: colors.gold }}>GH</Text></Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Pressable onPress={() => navigation.navigate('Wallet')} hitSlop={8} style={[styles.iconBtn, { width: undefined, paddingHorizontal: spacing.md }]}>
              <Text style={{ color: colors.gold, fontSize: typography.caption, fontWeight: fontWeights.bold }}>₵ Wallet</Text>
            </Pressable>
            <Pressable onPress={() => navigation.navigate('Inbox')} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Notifications">
              <Text style={{ fontSize: 15 }}>🔔</Text>
            </Pressable>
            <Pressable onPress={() => navigation.navigate('Me')} hitSlop={8} style={[styles.iconBtn, { borderColor: colors.gold }]}>
              <Text style={{ color: colors.gold, fontWeight: fontWeights.black }}>{(profile?.username ?? '?').slice(0, 1).toUpperCase()}</Text>
            </Pressable>
          </View>
        </View>
        <FadeIn style={styles.heroCopy}>
          <Eyebrow color={colors.cyan}>Ghana's mobile esports arena</Eyebrow>
          <Text style={styles.heroTitle}>Play. Win.{'\n'}<Text style={{ color: colors.gold }}>Get paid on MoMo.</Text></Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            {liveCount > 0 ? <View style={styles.statPill}><LiveDot size={6} /><Text style={styles.statText}>{liveCount} live</Text></View> : null}
            <View style={styles.statPill}><Text style={[styles.statText, { color: colors.green }]}>{openCount} open</Text></View>
            <View style={styles.statPill}><Text style={styles.statText}>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Loading…'}</Text></View>
          </View>
        </FadeIn>
      </ImageBackground>

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
                <View key={i} style={[styles.card, { padding: 0 }]}>
                  <Skeleton height={130} radius={0} />
                  <View style={{ padding: spacing.lg, gap: spacing.sm }}>
                    <Skeleton height={22} width="70%" />
                    <Skeleton height={14} width="45%" />
                    <Skeleton height={6} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>No tournaments in this list yet — check back soon.</Text>
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
        backgroundColor: active ? accent : colors.surface,
        borderColor: active ? accent : colors.border,
        borderWidth: 1,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        opacity: pressed ? 0.8 : 1,
        shadowColor: accent, shadowOpacity: active ? 0.5 : 0, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
      })}
    >
      <Text style={{ color: active ? '#0A0C10' : colors.textMuted, fontSize: typography.caption, fontWeight: fontWeights.bold, letterSpacing: 0.4 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { height: 260, justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.xl, paddingBottom: 0 },
  brand: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.black, letterSpacing: 3 },
  iconBtn: {
    width: 36, height: 36, borderRadius: radius.pill,
    backgroundColor: 'rgba(17,23,33,0.75)', borderWidth: 1, borderColor: colors.borderBright,
    alignItems: 'center', justifyContent: 'center',
  },
  heroCopy: { padding: spacing.xl, gap: spacing.xs },
  heroTitle: { color: colors.text, fontSize: typography.display, lineHeight: 38, fontWeight: fontWeights.black, letterSpacing: -0.5 },
  statPill: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(17,23,33,0.8)', borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  statText: { color: colors.textMuted, fontSize: typography.tiny, fontWeight: fontWeights.semibold },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cardArt: { height: 150, justifyContent: 'space-between' },
  cardArtTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  gamePill: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3, backgroundColor: 'rgba(7,9,13,0.6)' },
  livePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(244,63,94,0.18)', borderRadius: radius.pill, paddingRight: spacing.md, paddingLeft: 2 },
  liveText: { color: colors.red, fontSize: typography.tiny, fontWeight: fontWeights.black, letterSpacing: 1 },
  title: { color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 8 },
  prize: { color: colors.gold, fontSize: 24, fontWeight: fontWeights.black, letterSpacing: -0.5 },
  entry: { color: colors.text, fontSize: typography.subheading, fontWeight: fontWeights.bold },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  meta: { color: colors.textMuted, fontSize: typography.tiny, fontWeight: fontWeights.medium },
  empty: { color: colors.textMuted, fontSize: typography.body, textAlign: 'center', marginTop: spacing.xxl },
});
